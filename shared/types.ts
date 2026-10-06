export type Protocol = 'TCP' | 'UDP'
export type ServiceKind = 'development' | 'application' | 'system'

export interface PortService {
  id: string
  pid: number
  port: number
  protocol: Protocol
  addresses: string[]
  name: string
  processName: string
  framework: string | null
  projectPath: string | null
  projectSource: 'command' | 'parent' | null
  executablePath: string | null
  commandLine: string | null
  startedAt: string | null
  memoryMB: number | null
  kind: ServiceKind
  scope: 'local' | 'network' | 'interface'
  url: string | null
  protectedReason: string | null
  parentPid: number | null
}

export interface ScanResult {
  services: PortService[]
  scannedAt: string
  durationMs: number
  warnings: string[]
  machineName: string
}

export interface StopRequest {
  serviceId: string
  pid: number
  startedAt: string
  includeChildren: boolean
}

export interface PortlightApi {
  scan: () => Promise<ScanResult>
  stop: (request: StopRequest) => Promise<void>
  openUrl: (serviceId: string) => Promise<void>
  openFolder: (serviceId: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  exportSnapshot: () => Promise<boolean>
  windowAction: (action: 'minimize' | 'maximize' | 'close') => void
  isDesktop: boolean
}

declare global {
  interface Window {
    portlight?: PortlightApi
  }
}
