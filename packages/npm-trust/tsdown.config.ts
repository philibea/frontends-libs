import { defineConfig } from 'tsdown'

export default defineConfig({
  exports: true,
  dts: false,
  platform: 'node',
  target: ['node24'],
  entry: 'src/cli.ts',
})
