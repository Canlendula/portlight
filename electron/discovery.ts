import path from 'node:path'
import { readFile } from 'node:fs/promises'
import type { PortService, Protocol } from '../shared/types'

export interface Endpoint {
  pid: number
  port: number
  protocol: Protocol
  address: string
}
export interface ProcessInfo {
  pid: number
  parentPid: number
  name: string
  commandLine: string | null
  executablePath: string | null
  startedAt: string | null
  memoryMB: number | null
}
export interface RawScan {
  endpoints: Endpoint[]
  processes: ProcessInfo[]
  warnings: string[]
  fallbackNetstat?: string | null
}
const systemNames =
  /^(system|registry|secure system|memory compression|smss|csrss|wininit|winlogon|services|lsass|svchost|dwm|explorer|fontdrvhost|sihost)(\.exe)?$/i
const developmentNames =
  /^(node|bun|deno|python[\d.]*|ruby|php|java|dotnet|uvicorn|go|cargo)(\.exe)?$/i

export function parseNetstat(text: string): Endpoint[] {
  const endpoints: Endpoint[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    const protocol = parts[0]
    if (protocol !== 'TCP' && protocol !== 'UDP') continue
    if (protocol === 'TCP' && parts[3] !== 'LISTENING') continue
    const match = parts[1]?.match(/^(?:\[(.*)\]|(.*)):(\d+)$/)
    const pid = Number(parts.at(-1))
    if (!match || !Number.isInteger(pid)) continue
    endpoints.push({ protocol, pid, address: match[1] ?? match[2], port: Number(match[3]) })
  }
  return endpoints
}

export function tokenizeCommand(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
}

// Command lines are untrusted metadata. Do not follow UNC paths while scanning.
function isLocalPath(value: string) {
  return /^[a-z]:[\\/]/i.test(value)
}

export function projectFromCommand(command: string | null): string | null {
  if (!command) return null
  const tokens = tokenizeCommand(command)
  for (let i = 0; i < tokens.length; i++) {
    if (/^(--cwd|--prefix|--dir|--root|-C)$/.test(tokens[i]) && isLocalPath(tokens[i + 1] ?? ''))
      return path.win32.normalize(tokens[i + 1])
    const inline = tokens[i].match(/^(?:--cwd|--prefix|--dir|--root)=(.+)$/)
    if (inline && isLocalPath(inline[1])) return path.win32.normalize(inline[1])
  }
  for (const token of tokens) {
    const marker = token
      .replaceAll('/', String.fromCharCode(92))
      .toLowerCase()
      .indexOf('\\node_modules\\')
    if (marker > 0 && isLocalPath(token)) {
      const root = token.slice(0, marker)
      if (
        !/\\(?:AppData\\(?:Roaming\\npm|Local\\(?:pnpm|npm-cache))|Program Files(?: \(x86\))?\\nodejs)$/i.test(
          root,
        )
      )
        return path.win32.normalize(root)
    }
  }
  for (const token of tokens.slice(1)) {
    if (
      isLocalPath(token) &&
      /\.(?:[cm]?[jt]s|[jt]sx|py|rb|php)$/i.test(token) &&
      !/\\(?:node_modules|AppData)\\/i.test(token)
    )
      return path.win32.dirname(token)
  }
  return null
}

export function detectFramework(command: string | null, processName: string): string | null {
  const value = command ?? ''
  if (/(?:[\\/\s]|^)vite(?:[\\/\s.@-]|$)/i.test(value)) return 'Vite'
  if (/[\\/]next[\\/]|next(?:-server|\s+(dev|start))/i.test(value)) return 'Next.js'
  if (/nuxt|nuxi/i.test(value)) return 'Nuxt'
  if (/astro[\\/\s]/i.test(value)) return 'Astro'
  if (/webpack|react-scripts/i.test(value)) return 'Webpack'
  if (/uvicorn|fastapi/i.test(value)) return 'FastAPI'
  if (/manage\.py\s+runserver/i.test(value)) return 'Django'
  if (/flask/i.test(value)) return 'Flask'
  if (/^node(?:\.exe)?$/i.test(processName)) return 'Node.js'
  if (/^python/i.test(processName)) return 'Python'
  if (/^bun(?:\.exe)?$/i.test(processName)) return 'Bun'
  if (/^deno(?:\.exe)?$/i.test(processName)) return 'Deno'
  if (/^dotnet(?:\.exe)?$/i.test(processName)) return '.NET'
  return null
}

export function protectionReason(
  p: ProcessInfo,
  ownPids: Set<number>,
  windowsRoot = process.env.SystemRoot ?? 'C:\\Windows',
): string | null {
  if (ownPids.has(p.pid)) return 'Portlight 自身进程'
  if (
    p.pid <= 4 ||
    systemNames.test(p.name) ||
    p.executablePath?.toLowerCase().startsWith(windowsRoot.toLowerCase() + '\\')
  )
    return 'Windows 系统进程'
  if (!p.startedAt || !p.executablePath) return '无法核实进程身份或权限不足'
  return null
}

export function serviceUrl(
  protocol: Protocol,
  port: number,
  addresses: string[],
  command: string | null,
): string | null {
  if (protocol !== 'TCP') return null
  const ipv4 = addresses.includes('0.0.0.0') || addresses.some((a) => a.startsWith('127.'))
  const host = ipv4
    ? (addresses.find((a) => a.startsWith('127.')) ?? '127.0.0.1')
    : addresses.some((a) => a === '::' || a === '::1')
      ? '[::1]'
      : (addresses.find((a) => !a.includes(':')) ?? `[${addresses[0]}]`)
  const scheme = /(?:^|\s)--https(?:[=\s]|$)/.test(command ?? '') || port === 443 ? 'https' : 'http'
  return `${scheme}://${host}:${port}`
}

export async function buildServices(raw: RawScan, ownPid: number): Promise<PortService[]> {
  const processMap = new Map(raw.processes.map((p) => [p.pid, p]))
  const ownPids = new Set([ownPid])
  for (const p of raw.processes) {
    let current: ProcessInfo | undefined = p
    const seen = new Set<number>()
    while (current && !seen.has(current.pid)) {
      seen.add(current.pid)
      if (current.pid === ownPid) {
        ownPids.add(p.pid)
        break
      }
      current = processMap.get(current.parentPid)
    }
  }
  const groups = new Map<string, { endpoint: Endpoint; addresses: Set<string> }>()
  const endpoints = raw.fallbackNetstat ? parseNetstat(raw.fallbackNetstat) : raw.endpoints
  for (const endpoint of endpoints) {
    const id = `${endpoint.protocol}:${endpoint.port}:${endpoint.pid}`
    const group = groups.get(id) ?? { endpoint, addresses: new Set<string>() }
    group.addresses.add(endpoint.address)
    groups.set(id, group)
  }
  const packageCache = new Map<string, Promise<string | null>>()
  const packageName = (root: string) => {
    if (!packageCache.has(root))
      packageCache.set(
        root,
        readFile(path.win32.join(root, 'package.json'), 'utf8')
          .then((text) => {
            const name: unknown = JSON.parse(text).name
            return typeof name === 'string' && name.length < 160 ? name : null
          })
          .catch(() => null),
      )
    return packageCache.get(root)!
  }
  return Promise.all(
    [...groups].map(async ([id, { endpoint: e, addresses: set }]) => {
      const p = processMap.get(e.pid) ?? {
        pid: e.pid,
        parentPid: 0,
        name: e.pid === 4 ? 'System' : `Process ${e.pid}`,
        commandLine: null,
        executablePath: null,
        startedAt: null,
        memoryMB: null,
      }
      let projectPath = projectFromCommand(p.commandLine)
      let projectSource: PortService['projectSource'] = projectPath ? 'command' : null
      let parent = processMap.get(p.parentPid)
      const seen = new Set([p.pid])
      for (let depth = 0; !projectPath && parent && depth < 6 && !seen.has(parent.pid); depth++) {
        if (
          p.startedAt &&
          parent.startedAt &&
          Date.parse(parent.startedAt) > Date.parse(p.startedAt)
        )
          break
        seen.add(parent.pid)
        projectPath = projectFromCommand(parent.commandLine)
        if (projectPath) projectSource = 'parent'
        parent = processMap.get(parent.parentPid)
      }
      const framework = detectFramework(p.commandLine, p.name)
      const protectedReason = protectionReason(p, ownPids)
      const kind =
        protectedReason === 'Windows 系统进程'
          ? 'system'
          : developmentNames.test(p.name) || projectPath || framework
            ? 'development'
            : 'application'
      const addresses = [...set].sort()
      const scope = addresses.some((a) => a === '0.0.0.0' || a === '::')
        ? 'network'
        : addresses.every((a) => a.startsWith('127.') || a === '::1')
          ? 'local'
          : 'interface'
      return {
        id,
        pid: p.pid,
        port: e.port,
        protocol: e.protocol,
        addresses,
        name: projectPath
          ? ((await packageName(projectPath)) ?? path.win32.basename(projectPath))
          : p.name.replace(/\.exe$/i, ''),
        processName: p.name,
        framework,
        projectPath,
        projectSource,
        executablePath: p.executablePath,
        commandLine: p.commandLine,
        startedAt: p.startedAt,
        memoryMB: p.memoryMB,
        kind,
        scope,
        url: serviceUrl(e.protocol, e.port, addresses, p.commandLine),
        protectedReason,
        parentPid: p.parentPid || null,
      } satisfies PortService
    }),
  )
}
