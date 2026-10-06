import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electron from 'electron'
await import('./build-electron.mjs')
const server = await createServer()
await server.listen()
const url = server.resolvedUrls.local[0]
const env = { ...process.env, PORTLIGHT_DEV_URL: url }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: false })
console.log(`Portlight desktop → ${url}`)
app.once('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
process.once('SIGINT', () => app.kill())
