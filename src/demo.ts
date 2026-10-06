import type { PortlightApi, PortService, ScanResult } from '../shared/types'

const seeds = [
  ['5173', 'folio-studio', 'Vite', 'node.exe', 'D:\\Projects\\folio-studio', 'local'],
  [
    '3000',
    'commerce-dashboard',
    'Next.js',
    'node.exe',
    'D:\\Projects\\commerce-dashboard',
    'local',
  ],
  ['5174', 'shadcn-admin', 'Vite', 'node.exe', 'D:\\OpenSource\\shadcn-admin', 'network'],
  ['4321', 'personal-site', 'Astro', 'node.exe', 'D:\\Projects\\personal-site', 'local'],
  ['8000', 'api-playground', 'FastAPI', 'python.exe', 'D:\\Projects\\api-playground', 'local'],
  ['8080', 'design-system', 'Vite', 'node.exe', 'D:\\OpenSource\\design-system', 'network'],
  ['5432', 'postgres', '', 'postgres.exe', '', 'local'],
  ['6379', 'redis-server', '', 'redis-server.exe', '', 'local'],
  ['135', 'svchost', '', 'svchost.exe', '', 'network'],
  ['5353', 'mDNS', '', 'svchost.exe', '', 'network'],
]
let services: PortService[] = seeds.map((s, i) => {
  const pid = 14280 + i * 128
  const protocol = i === 9 ? 'UDP' : 'TCP'
  return {
    id: `${protocol}:${s[0]}:${pid}`,
    pid,
    port: Number(s[0]),
    protocol,
    name: s[1],
    framework: s[2] || null,
    processName: s[3],
    projectPath: s[4] || null,
    projectSource: s[4] ? 'command' : null,
    scope: s[5] as PortService['scope'],
    addresses: s[5] === 'network' ? ['0.0.0.0', '::'] : ['127.0.0.1'],
    executablePath:
      i < 6 ? 'C:\\Program Files\\nodejs\\node.exe' : 'C:\\Windows\\System32\\svchost.exe',
    commandLine: s[4]
      ? `"C:\\Program Files\\nodejs\\node.exe" "${s[4]}\\node_modules\\${s[2] === 'Vite' ? 'vite\\bin\\vite.js' : s[2].toLowerCase() + '\\bin\\start.js'}"`
      : null,
    startedAt: new Date(Date.now() - (i * 19 + 12) * 60000).toISOString(),
    memoryMB: [68.2, 214.8, 76.4, 103.6, 45.1, 87.3, 28.5, 12.1, 8, 7][i],
    kind: i < 6 ? 'development' : i < 8 ? 'application' : 'system',
    url: protocol === 'TCP' ? `http://127.0.0.1:${s[0]}` : null,
    protectedReason: i >= 8 ? 'Windows 系统进程' : null,
    parentPid: pid - 12,
  }
})

export const previewApi: PortlightApi = {
  isDesktop: false,
  scan: async (): Promise<ScanResult> => {
    await new Promise((resolve) => setTimeout(resolve, 450))
    return {
      services: [...services],
      scannedAt: new Date().toISOString(),
      durationMs: 450,
      warnings: [],
      machineName: 'DESKTOP-PREVIEW',
    }
  },
  stop: async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    services = services.filter((s) => s.pid !== request.pid)
  },
  openUrl: async () => {
    throw new Error('浏览器正在展示示例数据。请在桌面客户端中打开真实服务。')
  },
  openFolder: async () => {
    throw new Error('请在桌面客户端中打开项目目录。')
  },
  copyText: async (text) => {
    await navigator.clipboard.writeText(text)
  },
  exportSnapshot: async () => {
    const blob = new Blob([JSON.stringify({ preview: true, services }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'portlight-preview.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  },
  windowAction: () => {},
}
