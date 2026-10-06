import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'

await mkdir('dist-electron', { recursive: true })
await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  target: 'node22',
  sourcemap: true,
})
await copyFile('electron/scan.ps1', 'dist-electron/scan.ps1')
await copyFile('electron/stop.ps1', 'dist-electron/stop.ps1')
console.log('Electron main process and preload built.')
