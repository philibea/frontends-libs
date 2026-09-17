#!/usr/bin/env node
/* eslint-disable no-console */
import { appendFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { RELEASE_SUBJECT, CHANGESET_MESSAGE } from './constants.ts'
import { createTags, exec, findWorkspaceRoot, listWorkspacePackages, createChangesets } from './utils.ts'

const { log: logger } = console

const HELP = `Usage: release [options]

Bump and publish changed packages in the monorepo.

Detects which packages changed since the last "chore(release): publish" commit,
writes pnpm changeset files (all minor), then delegates to pnpm for version
bumping (including dependency propagation) and publishing.

Options:
  -r, --registry <url>   npm registry to publish to
      --dry-run          Report what would happen, no writes/publishes
      --skip-publish     Bump and tag, but don't publish to the registry
      --skip-push        Don't push the release commit and tags
      --by-commit        Create one changeset per commit (default: one changeset for all affected packages)
  -h, --help             Show this help

Environment variables for registry auth:
  NPM_REGISTRY_USER      Registry username
  NPM_REGISTRY_PASSWD    Registry password
`

type CliOptions = {
  dryRun: boolean
  skipPublish: boolean
  skipPush: boolean
  byCommit: boolean
  registry?: string
}

function parseCliOptions(): CliOptions | null {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      registry: { type: 'string', short: 'r' },
      'dry-run': { type: 'boolean', default: false },
      'skip-publish': { type: 'boolean', default: false },
      'skip-push': { type: 'boolean', default: false },
      'by-commit': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  if (values.help) {
    logger(HELP)
    return null
  }

  return {
    dryRun: values['dry-run'] === true,
    skipPublish: values['skip-publish'] === true,
    skipPush: values['skip-push'] === true,
    byCommit: values['by-commit'] === true,
    registry: values.registry,
  }
}

function findAffectedPackages(root: string, packages: ReturnType<typeof listWorkspacePackages>) {
  const lastSha =
    exec(`git log --grep="^${RELEASE_SUBJECT}" -1 --format="%H"`, {
      cwd: root,
    }) || null
  const range = lastSha ? `${lastSha}..HEAD` : 'HEAD~50..HEAD'
  const changedFiles = exec(`git diff --name-only ${range}`, { cwd: root }).split('\n').filter(Boolean)

  const affected = packages.filter(pkg => !pkg.private && changedFiles.some(f => f.startsWith(`${pkg.relativePath}/`)))
  return { range, affected }
}

function publishPackages(root: string, registry?: string) {
  const user = process.env['NPM_REGISTRY_USER']
  const passwd = process.env['NPM_REGISTRY_PASSWD']
  if (registry && user && passwd) {
    const host = registry.replace(/^https?:\/\//u, '')
    const auth = Buffer.from(`${user}:${passwd}`).toString('base64')
    const npmrcPath = join(root, '.npmrc')
    appendFileSync(npmrcPath, `\n//${host}/:_auth=${auth}\n`)
    logger(`[release] authenticated to ${host}`)
  }
  const flag = registry ? ` --registry ${registry}` : ''
  exec(`pnpm publish -r --no-git-checks --access public${flag}`, {
    cwd: root,
    stdio: 'inherit',
  })
  logger('[release] published')
}

function commitAndTag(root: string, affected: ReturnType<typeof listWorkspacePackages>, skipPush: boolean) {
  const updated = listWorkspacePackages(root)

  exec('git add -A', { cwd: root })
  exec('git commit -m "chore(release): publish" --no-verify', { cwd: root })

  createTags({
    root,
    affectedPackages: affected,
    updatedPackages: updated,
  })

  if (!skipPush) {
    exec('git push origin HEAD --tags --no-verify', { cwd: root })
    logger('[release] pushed')
  }

  logger('[release] done.')
}

function main() {
  const options = parseCliOptions()
  if (!options) return

  const root = findWorkspaceRoot(process.cwd())
  const packages = listWorkspacePackages(root)

  const { range, affected } = findAffectedPackages(root, packages)

  logger(`[release] ${affected.length} packages to bump (dryRun=${options.dryRun})`)
  for (const pkg of affected) logger(`  - ${pkg.name}: ${pkg.version}`)

  if (options.dryRun || affected.length === 0) return

  createChangesets({
    root,
    range,
    packages: affected,
    byCommit: options.byCommit,
    defaultSummary: CHANGESET_MESSAGE,
  })

  // Bump versions — pnpm handles dependency propagation.
  // In recursive mode pnpm never creates git commits/tags itself, so the
  // working tree is left dirty for us to commit explicitly below — but only
  // after publish has succeeded, so a registry failure leaves the remote
  // untouched and the run can be retried from a pristine state.
  exec('pnpm version -r --no-git-checks --tag-version-prefix ""', {
    cwd: root,
    stdio: 'inherit',
  })
  exec('rm -rf .changeset/*', { cwd: root })

  // Publish BEFORE committing/tagging/pushing. If publish fails (registry
  // down, auth expired, network, version already exists, ...) we abort and
  // leave the remote untouched — no tags pointing at unpublished versions.
  // `pnpm publish -r` skips versions already on the registry, so retries
  // are idempotent and only publish what's missing.
  if (!options.skipPublish) {
    publishPackages(root, options.registry)
  }

  commitAndTag(root, affected, options.skipPush)
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  try {
    main()
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
