import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildServices,
  detectFramework,
  parseNetstat,
  projectFromCommand,
  protectionReason,
  serviceUrl,
  type ProcessInfo,
} from '../electron/discovery'

const processInfo = (overrides: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 1234,
  parentPid: 1000,
  name: 'node.exe',
  commandLine: 'node server.js',
  executablePath: 'D:\\nodejs\\node.exe',
  startedAt: '2026-10-05T01:00:00.1234560Z',
  memoryMB: 62.5,
  ...overrides,
})

test('project inference never follows network UNC paths from command-line metadata', () => {
  assert.equal(
    projectFromCommand('node "\\\\server\\share\\node_modules\\vite\\bin\\vite.js"'),
    null,
  )
  assert.equal(projectFromCommand('node --root "\\\\server\\share"'), null)
  assert.equal(projectFromCommand('node "\\\\server\\share\\server.js"'), null)
})

test('netstat parses IPv4, IPv6 and UDP while excluding established connections', () => {
  assert.deepEqual(
    parseNetstat(
      '  TCP    127.0.0.1:5173  0.0.0.0:0  LISTENING  1234\n  TCP [::1]:5173 [::]:0 LISTENING 1234\n TCP 127.0.0.1:443 127.0.0.1:60000 ESTABLISHED 2222\n UDP 0.0.0.0:5353 *:* 4567',
    ),
    [
      { protocol: 'TCP', pid: 1234, address: '127.0.0.1', port: 5173 },
      { protocol: 'TCP', pid: 1234, address: '::1', port: 5173 },
      { protocol: 'UDP', pid: 4567, address: '0.0.0.0', port: 5353 },
    ],
  )
})
test('pnpm Vite path resolves to project, including spaces and unicode', () => {
  assert.equal(
    projectFromCommand(
      '"D:\\nodejs\\node.exe" "D:\\开发项目\\my app\\node_modules\\.pnpm\\vite@8.3.2\\node_modules\\vite\\bin\\vite.js"',
    ),
    'D:\\开发项目\\my app',
  )
})
test('absolute root flag takes precedence over dependency path', () => {
  assert.equal(
    projectFromCommand(
      'node D:\\tool\\node_modules\\vite\\bin\\vite.js --root "D:\\project with spaces"',
    ),
    'D:\\project with spaces',
  )
  assert.equal(projectFromCommand('node D:/project/server.mjs --cwd=D:/workspace'), 'D:\\workspace')
})
test('absolute scripts infer directory and relative scripts remain unknown', () => {
  assert.equal(
    projectFromCommand('"D:\\nodejs\\node.exe" "D:\\work\\backend\\server.mjs"'),
    'D:\\work\\backend',
  )
  assert.equal(projectFromCommand('node ./server.mjs'), null)
})
test('global pnpm/npm installations are not reported as project roots', () => {
  assert.equal(
    projectFromCommand(
      'node "C:\\Users\\C\\AppData\\Roaming\\npm\\node_modules\\vite\\bin\\vite.js"',
    ),
    null,
  )
  assert.equal(
    projectFromCommand('node "C:\\Program Files\\nodejs\\node_modules\\vite\\bin\\vite.js"'),
    null,
  )
})
test('framework detection covers Vite, Next server, Astro and Python API', () => {
  assert.equal(
    detectFramework(
      'node D:\\work\\node_modules\\.pnpm\\vite@8\\node_modules\\vite\\bin\\vite.js',
      'node.exe',
    ),
    'Vite',
  )
  assert.equal(detectFramework('next-server (v16)', 'node.exe'), 'Next.js')
  assert.equal(
    detectFramework('node D:\\site\\node_modules\\astro\\astro.js dev', 'node.exe'),
    'Astro',
  )
  assert.equal(detectFramework('python -m uvicorn app:app', 'python.exe'), 'FastAPI')
})
test('system, own and unidentified processes are protected', () => {
  assert.equal(protectionReason(processInfo({ pid: 4 }), new Set()), 'Windows 系统进程')
  assert.equal(
    protectionReason(processInfo({ name: 'svchost.exe' }), new Set()),
    'Windows 系统进程',
  )
  assert.equal(
    protectionReason(
      processInfo({ executablePath: 'C:\\Windows\\System32\\some-service.exe' }),
      new Set(),
    ),
    'Windows 系统进程',
  )
  assert.equal(protectionReason(processInfo(), new Set([1234])), 'Portlight 自身进程')
  assert.equal(
    protectionReason(processInfo({ startedAt: null }), new Set()),
    '无法核实进程身份或权限不足',
  )
  assert.equal(protectionReason(processInfo(), new Set()), null)
})
test('URL inference respects IPv6, IPv4 loopback variants and UDP', () => {
  assert.equal(serviceUrl('TCP', 5173, ['::1'], null), 'http://[::1]:5173')
  assert.equal(serviceUrl('TCP', 3000, ['0.0.0.0', '::'], null), 'http://127.0.0.1:3000')
  assert.equal(serviceUrl('TCP', 5173, ['127.0.0.2'], null), 'http://127.0.0.2:5173')
  assert.equal(serviceUrl('TCP', 5173, ['127.0.0.1'], 'vite --https'), 'https://127.0.0.1:5173')
  assert.equal(serviceUrl('UDP', 5353, ['0.0.0.0'], null), null)
})
test('merges dual-stack endpoints but preserves protocol and PID distinctions', async () => {
  const services = await buildServices(
    {
      endpoints: [
        { pid: 1234, port: 5173, protocol: 'TCP', address: '0.0.0.0' },
        { pid: 1234, port: 5173, protocol: 'TCP', address: '::' },
        { pid: 1234, port: 5173, protocol: 'UDP', address: '0.0.0.0' },
        { pid: 1235, port: 5173, protocol: 'TCP', address: '127.0.0.2' },
      ],
      processes: [processInfo(), processInfo({ pid: 1235 })],
      warnings: [],
    },
    999,
  )
  assert.equal(services.length, 3)
  assert.deepEqual(services[0].addresses, ['0.0.0.0', '::'])
  assert.equal(services[0].scope, 'network')
  assert.equal(services[1].url, null)
})
test('parent project inference stops on cycles and reused parent PIDs', async () => {
  const endpoints = [{ pid: 1234, port: 5173, protocol: 'TCP' as const, address: '127.0.0.1' }]
  const parent = processInfo({
    pid: 1000,
    parentPid: 1234,
    commandLine: 'node D:\\repo\\node_modules\\vite\\bin\\vite.js',
  })
  const first = await buildServices(
    { endpoints, processes: [processInfo(), parent], warnings: [] },
    999,
  )
  assert.equal(first[0].projectPath, 'D:\\repo')
  assert.equal(first[0].projectSource, 'parent')
  const reused = await buildServices(
    {
      endpoints,
      processes: [processInfo(), { ...parent, startedAt: '2026-10-05T02:00:00Z' }],
      warnings: [],
    },
    999,
  )
  assert.equal(reused[0].projectPath, null)
  const cyclic = await buildServices(
    { endpoints, processes: [processInfo(), { ...parent, commandLine: 'cmd.exe' }], warnings: [] },
    999,
  )
  assert.equal(cyclic[0].projectPath, null)
})
test('protects all descendants of the app', async () => {
  const services = await buildServices(
    {
      endpoints: [{ pid: 1234, port: 5173, protocol: 'TCP', address: '::1' }],
      processes: [
        processInfo(),
        processInfo({ pid: 1000, parentPid: 999 }),
        processInfo({ pid: 999, parentPid: 0 }),
      ],
      warnings: [],
    },
    999,
  )
  assert.equal(services[0].protectedReason, 'Portlight 自身进程')
})
