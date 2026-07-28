# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) to manage versions and releases.

## Workflow

1. **During development**: Run `pnpm changeset` to describe changes (major/minor/patch + changelog entry). Commit the generated changeset file alongside your code changes.
2. **On push to `main`**: The `release.yml` workflow opens/updates a "Version Packages" PR aggregating pending changesets.
3. **To release**: Merge the "Version Packages" PR — the workflow will publish to npm and tag the release.
