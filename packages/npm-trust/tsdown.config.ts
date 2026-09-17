import { defineConfig } from 'tsdown'

export default defineConfig({
  dts: true,
  target: 'baseline-widely-available',
  platform: 'node',
  entry: 'src/cli.ts',
  unbundle: true,
})
