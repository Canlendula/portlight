import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { hostname } from 'node:os'
import path from 'node:path'
import { buildServices, type RawScan } from './discovery'
import type { PortService, ScanResult, StopRequest } from '../shared/types'

const execFileAsync = promisify(execFile)
const powershell = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

export class PortServiceManager {
  private snapshot: ScanResult | null = null
  private scanning: Promise<ScanResult> | null = null
  private stopping = new Set<number>()
  constructor(
    private scriptDirectory: string,
    private ownPid = process.pid,
  ) {}

  scan(): Promise<ScanResult> {
    if (this.scanning) return this.scanning
    this.scanning = this.collect().finally(() => {
      this.scanning = null
    })
    return this.scanning
  }

  private async collect(): Promise<ScanResult> {
    if (process.platform !== 'win32') throw new Error('当前版本支持 Windows 10 / 11。')
    const started = performance.now()
    try {
      const { stdout } = await execFileAsync(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(this.scriptDirectory, 'scan.ps1'),
        ],
        { windowsHide: true, timeout: 25000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      )
      const raw: RawScan = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
      const services = (await buildServices(raw, this.ownPid)).sort(
        (a, b) => a.port - b.port || a.pid - b.pid,
      )
      const warningText: Record<string, string> = {
        NETWORK_FALLBACK: 'Windows 网络接口读取失败，已使用 netstat 扫描。',
        PROCESS_METADATA_UNAVAILABLE:
          '部分进程信息无法读取。可尝试以管理员身份运行，以查看更多项目详情。',
      }
      this.snapshot = {
        services,
        scannedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
        warnings: raw.warnings.map((w) => warningText[w] ?? w),
        machineName: hostname(),
      }
      return this.snapshot
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      throw new Error(
        `扫描失败，请检查 PowerShell 和本机进程访问权限。${cause.includes('ETIMEDOUT') ? '扫描已超时，请重试。' : ''}`,
        { cause },
      )
    }
  }

  getService(id: unknown): PortService {
    if (typeof id !== 'string') throw new Error('无效的服务标识。')
    const service = this.snapshot?.services.find((s) => s.id === id)
    if (!service) throw new Error('服务已经退出，请刷新列表。')
    return service
  }

  getSnapshot() {
    return this.snapshot
  }

  async stop(input: StopRequest): Promise<void> {
    if (
      !input ||
      typeof input.serviceId !== 'string' ||
      !Number.isSafeInteger(input.pid) ||
      input.pid <= 4 ||
      typeof input.startedAt !== 'string' ||
      typeof input.includeChildren !== 'boolean'
    )
      throw new Error('无效的进程信息。')
    if (this.stopping.has(input.pid)) throw new Error('正在结束此进程，请稍候。')
    this.stopping.add(input.pid)
    try {
      await this.scan()
      const service = this.getService(input.serviceId)
      if (service.pid !== input.pid || service.startedAt !== input.startedAt)
        throw new Error('进程已变化，请刷新后重试。')
      if (service.protectedReason) throw new Error(service.protectedReason)
      const args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(this.scriptDirectory, 'stop.ps1'),
        '-TargetPid',
        String(service.pid),
        '-ExpectedStart',
        input.startedAt,
        '-ExpectedPort',
        String(service.port),
        '-Protocol',
        service.protocol,
      ]
      if (input.includeChildren) args.push('-IncludeChildren')
      await execFileAsync(powershell, args, {
        windowsHide: true,
        timeout: 20000,
        encoding: 'utf8',
      }).catch((error) => {
        throw new Error('结束失败：进程可能已经退出、身份已变化，或需要管理员权限。', {
          cause: error,
        })
      })
      await this.scan()
    } finally {
      this.stopping.delete(input.pid)
    }
  }
}
