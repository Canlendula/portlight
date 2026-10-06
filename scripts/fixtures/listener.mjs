import http from 'node:http'
import dgram from 'node:dgram'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const tcp = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/plain')
  res.end('Portlight owned test fixture')
})
const tcp2 = http.createServer((_req, res) => res.end('Portlight second binding'))
const udp = dgram.createSocket('udp4')
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
await Promise.all([
  listen(tcp),
  listen(tcp2),
  new Promise((resolve) => udp.bind(0, '127.0.0.1', resolve)),
])
let child
let childData
if (process.argv.includes('--tree')) {
  child = fork(fileURLToPath(import.meta.url), ['--leaf'], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  childData = await new Promise((resolve) => child.once('message', resolve))
}
process.send?.({
  pid: process.pid,
  tcp: tcp.address().port,
  tcp2: tcp2.address().port,
  udp: udp.address().port,
  child: childData,
})
process.on('message', (message) => {
  if (message === 'shutdown') {
    child?.send('shutdown')
    tcp.close()
    tcp2.close()
    udp.close()
    process.disconnect?.()
  }
})
