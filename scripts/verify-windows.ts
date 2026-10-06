import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import path from 'node:path'
import { PortServiceManager } from '../electron/service'

type Fixture = { pid: number; tcp: number; tcp2: number; udp: number; child?: Fixture }
const owned: ChildProcess[] = []
const fixture = async (tree = false): Promise<Fixture> => {
  const child = fork(path.resolve('scripts/fixtures/listener.mjs'), tree ? ['--tree'] : [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    execArgv: [],
  })
  owned.push(child)
  return (await once(child, 'message', { signal: AbortSignal.timeout(10000) }))[0] as Fixture
}
const manager = new PortServiceManager(path.resolve(process.argv[2] ?? 'electron'), -1)
try {
  const single = await fixture()
  const tree = await fixture(true)
  let scan = await manager.scan()
  const singleService = scan.services.find((s) => s.pid === single.pid && s.port === single.tcp)!
  assert.ok(singleService, 'real TCP listener is discovered')
  assert.equal(singleService.projectPath, path.resolve('scripts/fixtures'))
  assert.equal(scan.services.filter((s) => s.pid === single.pid).length, 3)
  assert.ok(scan.services.find((s) => s.pid === single.pid && s.protocol === 'UDP'))
  console.log('PASS: real TCP/UDP discovery, metadata, and project path')
  await assert.rejects(
    () =>
      manager.stop({
        serviceId: singleService.id,
        pid: single.pid,
        startedAt: '2000-01-01T00:00:00.0000000Z',
        includeChildren: false,
      }),
    /进程已变化/,
  )
  assert.equal((await fetch(singleService.url!)).status, 200)
  console.log('PASS: stale process identity refused without terminating fixture')
  await manager.stop({
    serviceId: singleService.id,
    pid: single.pid,
    startedAt: singleService.startedAt!,
    includeChildren: false,
  })
  scan = await manager.scan()
  assert.ok(
    !scan.services.some((s) => s.pid === single.pid),
    'all ports of stopped process must be released',
  )
  assert.ok(
    scan.services.some((s) => s.pid === tree.pid),
    'independent fixture must remain running',
  )
  await assert.rejects(() => fetch(singleService.url!))
  console.log('PASS: stopping one owned process releases every binding; unrelated fixture survives')
  const treeService = scan.services.find((s) => s.pid === tree.pid && s.port === tree.tcp)!
  await manager.stop({
    serviceId: treeService.id,
    pid: tree.pid,
    startedAt: treeService.startedAt!,
    includeChildren: true,
  })
  scan = await manager.scan()
  assert.ok(!scan.services.some((s) => s.pid === tree.pid || s.pid === tree.child?.pid))
  console.log('PASS: optional child-process termination releases parent and child ports')
  console.log(
    `Windows integration passed. Final snapshot: ${scan.services.length} bindings; ${scan.durationMs} ms; ${scan.warnings.length} warnings.`,
  )
} finally {
  for (const child of owned) {
    if (child.connected) child.send('shutdown')
  }
}
