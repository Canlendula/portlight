import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Ellipsis,
  ExternalLink,
  Folder,
  Globe2,
  HardDrive,
  Laptop,
  ListFilter,
  LoaderCircle,
  Minus,
  Monitor,
  Network,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  SquareTerminal,
  Star,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type { PortService, ScanResult } from '../shared/types'
import { previewApi } from './demo'

const api = window.portlight ?? previewApi
type View = 'services' | 'favorites' | 'activity'
type Category = 'development' | 'all' | 'system'
type Notice = { id: number; message: string; error?: boolean }
type Log = {
  id: number
  time: string
  title: string
  detail: string
  type: 'scan' | 'stop' | 'change'
}
type Settings = { interval: number; includeUdp: boolean; compact: boolean }

function readSaved<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(`portlight:${key}`)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}
function favoriteKey(s: PortService) {
  return `${s.projectPath ?? s.processName}|${s.protocol}|${s.port}`
}
function elapsed(start: string | null) {
  if (!start) return '未知'
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(start)) / 60000))
  if (minutes < 1) return '刚刚启动'
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
  return `${Math.floor(minutes / 1440)} 天 ${Math.floor((minutes % 1440) / 60)} 小时`
}
function clock(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false })
}
function FrameworkIcon({ service, large = false }: { service: PortService; large?: boolean }) {
  const framework = service.framework
  const cls =
    framework === 'Vite'
      ? 'vite'
      : framework === 'Next.js'
        ? 'next'
        : framework === 'FastAPI' || framework === 'Python'
          ? 'python'
          : framework === 'Astro'
            ? 'astro'
            : service.kind === 'system'
              ? 'system'
              : 'node'
  return (
    <span className={`framework-icon ${cls} ${large ? 'large' : ''}`}>
      {framework === 'Vite' ? (
        <Zap fill="currentColor" size={large ? 27 : 20} />
      ) : framework === 'Next.js' ? (
        <span className="next-letter">
          N<span>↗</span>
        </span>
      ) : framework === 'Astro' ? (
        <span className="astro-letter">A</span>
      ) : framework === 'FastAPI' ? (
        <Zap size={20} />
      ) : service.kind === 'system' ? (
        <ShieldCheck size={20} />
      ) : framework === 'Python' ? (
        <Braces size={20} />
      ) : (
        <Boxes size={large ? 25 : 20} />
      )}
    </span>
  )
}
function Logo() {
  return (
    <svg width="35" height="35" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="17" fill="#214e3e" />
      <path
        d="M20 44V21h15a9 9 0 0 1 0 18H28"
        fill="none"
        stroke="#c2e5b5"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="45" cy="46" r="4" fill="#edf8c8" />
    </svg>
  )
}

function Modal({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key === 'Tab') {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,[tabindex="0"]',
        )
        if (!elements?.length) return
        const first = elements[0],
          last = elements[elements.length - 1]
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          event.preventDefault()
          last.focus()
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === ref.current)
        ) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      previous?.focus()
    }
  }, [])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${className}`}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanError, setScanError] = useState<string | null>(null)
  const [view, setView] = useState<View>('services')
  const [category, setCategory] = useState<Category>('development')
  const [query, setQuery] = useState('')
  const [protocol, setProtocol] = useState('all')
  const [sort, setSort] = useState<'port' | 'name' | 'time'>('port')
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = readSaved<unknown>('favorites', [])
    return Array.isArray(saved) ? saved.filter((v) => typeof v === 'string') : []
  })
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = readSaved<Partial<Settings> | null>('settings', null)
    return {
      interval: [0, 5, 10, 30].includes(saved?.interval ?? -1) ? saved!.interval! : 5,
      includeUdp: saved?.includeUdp === true,
      compact: saved?.compact === true,
    }
  })
  const [paused, setPaused] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [stopTargets, setStopTargets] = useState<PortService[]>([])
  const [stopping, setStopping] = useState(false)
  const [includeChildren, setIncludeChildren] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const scanning = useRef(false)
  const previous = useRef<ScanResult | null>(null)
  const currentSettings = useRef(settings)
  currentSettings.current = settings
  const searchRef = useRef<HTMLInputElement>(null)

  const notify = useCallback((message: string, error = false) => {
    const id = Date.now() + Math.random()
    setNotices((n) => [...n.slice(-2), { id, message, error }])
    setTimeout(() => setNotices((n) => n.filter((t) => t.id !== id)), error ? 7000 : 3500)
  }, [])
  const addLog = useCallback(
    (title: string, detail: string, type: Log['type']) =>
      setLogs((l) =>
        [
          { id: Date.now() + Math.random(), time: new Date().toISOString(), title, detail, type },
          ...l,
        ].slice(0, 80),
      ),
    [],
  )
  const refresh = useCallback(
    async (manual = false) => {
      if (scanning.current) return
      scanning.current = true
      setLoading(true)
      try {
        const result = await api.scan()
        if (!previous.current)
          addLog('首次扫描完成', `发现 ${result.services.length} 个端口绑定`, 'scan')
        else {
          const monitored = (s: PortService) =>
            s.kind !== 'system' && (currentSettings.current.includeUdp || s.protocol === 'TCP')
          const before = new Set(
            previous.current.services.filter(monitored).map((s) => `${s.id}:${s.startedAt}`),
          )
          const after = new Set(
            result.services.filter(monitored).map((s) => `${s.id}:${s.startedAt}`),
          )
          const added = result.services.filter(
            (s) => monitored(s) && !before.has(`${s.id}:${s.startedAt}`),
          )
          const removed = previous.current.services.filter(
            (s) => monitored(s) && !after.has(`${s.id}:${s.startedAt}`),
          )
          const describe = (services: PortService[]) =>
            services
              .slice(0, 4)
              .map((s) => `${s.name} :${s.port}`)
              .join('、') + (services.length > 4 ? ` 等 ${services.length} 项` : '')
          if (added.length || removed.length)
            addLog(
              `${added.length} 个服务上线 · ${removed.length} 个离线`,
              [
                added.length ? `上线：${describe(added)}` : '',
                removed.length ? `离线：${describe(removed)}` : '',
              ]
                .filter(Boolean)
                .join('；'),
              'change',
            )
        }
        previous.current = result
        setSnapshot(result)
        setScanError(null)
        setSelected((ids) => ids.filter((id) => result.services.some((s) => s.id === id)))
        if (manual) notify(`已刷新，发现 ${result.services.length} 个端口绑定`)
      } catch (error) {
        setScanError(error instanceof Error ? error.message : '扫描失败，请重试。')
      } finally {
        scanning.current = false
        setLoading(false)
      }
    },
    [addLog, notify],
  )
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (!settings.interval || paused || stopping || stopTargets.length) return
    const timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, settings.interval * 1000)
    return () => clearInterval(timer)
  }, [settings.interval, paused, refresh, stopping, stopTargets.length])
  useEffect(() => {
    try {
      localStorage.setItem('portlight:favorites', JSON.stringify(favorites))
    } catch {}
  }, [favorites])
  useEffect(() => {
    try {
      localStorage.setItem('portlight:settings', JSON.stringify(settings))
    } catch {}
  }, [settings])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape') {
        setRowMenu(null)
        if (!settingsOpen && !stopTargets.length && !helpOpen) setDetailId(null)
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [settingsOpen, stopTargets.length, helpOpen])

  const all = snapshot?.services ?? []
  const available = all.filter((s) => settings.includeUdp || s.protocol === 'TCP')
  const favoriteServices = available.filter((s) => favorites.includes(favoriteKey(s)))
  const devCount = available.filter((s) => s.kind === 'development').length
  const processCount = new Set(available.map((s) => s.pid)).size
  const portCount = new Set(available.map((s) => `${s.protocol}:${s.port}`)).size
  const visible = useMemo(() => {
    let result = (snapshot?.services ?? []).filter(
      (s) => settings.includeUdp || s.protocol === 'TCP',
    )
    if (view === 'favorites') result = result.filter((s) => favorites.includes(favoriteKey(s)))
    else if (category !== 'all') result = result.filter((s) => s.kind === category)
    if (protocol !== 'all') result = result.filter((s) => s.protocol === protocol)
    const q = query.trim().toLowerCase()
    if (q)
      result = result.filter((s) =>
        [
          s.name,
          s.port,
          s.pid,
          s.framework,
          s.projectPath,
          s.processName,
          s.protocol,
          ...s.addresses,
        ]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    return result.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'time'
          ? (Date.parse(b.startedAt ?? '') || 0) - (Date.parse(a.startedAt ?? '') || 0)
          : a.port - b.port,
    )
  }, [snapshot, settings.includeUdp, view, favorites, category, protocol, query, sort])
  const detail = all.find((s) => s.id === detailId)
  const eligible = visible.filter((s) => !s.protectedReason)
  const selectedServices = visible.filter((s) => selected.includes(s.id) && !s.protectedReason)
  const allChecked = eligible.length > 0 && eligible.every((s) => selected.includes(s.id))
  const isAuto = settings.interval > 0 && !paused
  const changeView = (next: View) => {
    setView(next)
    setSelected([])
    setQuery('')
    setDetailId(null)
    setRowMenu(null)
  }
  const toggleFavorite = (s: PortService) =>
    setFavorites((f) =>
      f.includes(favoriteKey(s)) ? f.filter((k) => k !== favoriteKey(s)) : [...f, favoriteKey(s)],
    )
  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action()
      if (success) notify(success)
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : '操作失败',
        true,
      )
    }
  }
  const requestStop = (services: PortService[]) => {
    setStopTargets([...new Map(services.map((s) => [s.pid, s])).values()])
    setIncludeChildren(false)
    setRowMenu(null)
  }
  const confirmStop = async () => {
    setStopping(true)
    let count = 0
    for (const target of stopTargets) {
      try {
        await api.stop({
          serviceId: target.id,
          pid: target.pid,
          startedAt: target.startedAt!,
          includeChildren,
        })
        count++
        addLog(
          `已结束 ${target.name}`,
          `PID ${target.pid} · ${target.protocol} :${target.port}${api.isDesktop ? '' : ' · 示例操作'}`,
          'stop',
        )
      } catch (error) {
        notify(
          `${target.name}：${error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '结束失败'}`,
          true,
        )
      }
    }
    if (count) notify(`已结束 ${count} 个进程${api.isDesktop ? '' : '（示例）'}`)
    setStopping(false)
    setStopTargets([])
    setSelected([])
    await refresh()
  }
  const exportSnapshot = async () => {
    try {
      if (await api.exportSnapshot()) notify('端口快照已导出')
    } catch {
      notify('导出失败，请重试。', true)
    }
  }

  return (
    <div className={`app ${settings.compact ? 'compact' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span>
            Portlight<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="workspace">
          <div className="workspace-icon">
            <Monitor size={18} />
          </div>
          <div>
            <strong>本机工作空间</strong>
            <span>Windows · 127.0.0.1</span>
          </div>
          <span className="status-dot" />
        </div>
        <div className="nav-label">工作台</div>
        <nav>
          <button
            className={view === 'services' ? 'nav-item active' : 'nav-item'}
            onClick={() => changeView('services')}
          >
            <Network size={18} />
            <span>本地服务</span>
            <span className="nav-count">{available.length}</span>
          </button>
          <button
            className={view === 'favorites' ? 'nav-item active' : 'nav-item'}
            onClick={() => changeView('favorites')}
          >
            <Star size={18} />
            <span>我的收藏</span>
            {favoriteServices.length > 0 && (
              <span className="nav-count">{favoriteServices.length}</span>
            )}
          </button>
          <button
            className={view === 'activity' ? 'nav-item active' : 'nav-item'}
            onClick={() => changeView('activity')}
          >
            <Clock3 size={18} />
            <span>操作记录</span>
          </button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-tip">
          <div className="tip-icon">
            <Code2 size={18} />
          </div>
          <strong>少找端口，多写代码。</strong>
          <p>
            所有本地服务，
            <br />
            一个清晰的工作空间。
          </p>
          <div className="tip-port">
            <span className="status-dot" />
            <code>localhost</code>
            <span className="signal-bars">
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={18} />
            <span>偏好设置</span>
          </button>
          <div className="machine">
            <span className={`status-dot ${scanError ? 'bad' : ''}`} />
            <span title={snapshot?.machineName}>{snapshot?.machineName ?? '正在连接本机…'}</span>
            <small>v1.0</small>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <div className="titlebar">
          <div className="breadcrumbs">
            <span>工作台</span>
            <ChevronRight size={13} />
            <strong>
              {view === 'services' ? '本地服务' : view === 'favorites' ? '我的收藏' : '操作记录'}
            </strong>
          </div>
          <div className="titlebar-right">
            <span className="local-badge">
              <ShieldCheck size={13} />
              仅在本机运行
            </span>
            {api.isDesktop && (
              <div className="window-controls">
                <button aria-label="最小化" onClick={() => api.windowAction('minimize')}>
                  <Minus size={16} />
                </button>
                <button aria-label="最大化或还原" onClick={() => api.windowAction('maximize')}>
                  <Square size={12} />
                </button>
                <button
                  className="window-close"
                  aria-label="关闭窗口"
                  onClick={() => api.windowAction('close')}
                >
                  <X size={17} />
                </button>
              </div>
            )}
          </div>
        </div>
        <main>
          {!api.isDesktop && (
            <div className="preview-banner">
              <Monitor size={14} />
              <span>界面预览 · 当前为示例数据，真实端口与进程操作请运行桌面客户端。</span>
              <code>pnpm dev</code>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR LOCAL WORKSPACE</div>
              <h1>
                {view === 'services' ? '本地服务' : view === 'favorites' ? '我的收藏' : '操作记录'}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {view === 'services'
                  ? '正在运行什么，端口被谁占用，一目了然。'
                  : view === 'favorites'
                    ? '常用项目，随时关注。收藏会在下次启动时保留。'
                    : '本次会话中的应用服务变化与进程操作，不记录系统服务变动。'}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                onClick={() => void exportSnapshot()}
                disabled={!snapshot}
              >
                <ArrowDownToLine size={15} />
                导出快照
              </button>
              <button
                className="button primary"
                onClick={() => void refresh(true)}
                disabled={loading}
              >
                <RefreshCw size={15} className={loading ? 'spin' : ''} />
                {loading ? '扫描中' : '刷新端口'}
              </button>
            </div>
          </div>

          <section className="stats" aria-label="端口统计">
            <button
              className={`stat-card ${view === 'services' && category === 'development' ? 'selected-stat' : ''}`}
              onClick={() => {
                changeView('services')
                setCategory('development')
              }}
            >
              <div>
                <span className="stat-label">开发服务</span>
                <div className="stat-number">
                  {snapshot ? String(devCount).padStart(2, '0') : '—'}
                  <span className="stat-note">
                    <span className="status-dot" />
                    正在运行
                  </span>
                </div>
              </div>
              <div className="stat-icon mint">
                <Code2 size={21} />
              </div>
              <span className="stat-foot">
                Vite、Next.js 与其他开发进程
                <ArrowUpRight size={14} />
              </span>
            </button>
            <button
              className={`stat-card ${view === 'services' && category === 'all' ? 'selected-stat' : ''}`}
              onClick={() => {
                changeView('services')
                setCategory('all')
              }}
            >
              <div>
                <span className="stat-label">占用端口</span>
                <div className="stat-number">
                  {snapshot ? String(portCount).padStart(2, '0') : '—'}
                  <span className="stat-note">
                    {settings.includeUdp ? 'TCP + UDP' : 'TCP 监听'}
                  </span>
                </div>
              </div>
              <div className="stat-icon lavender">
                <Network size={21} />
              </div>
              <span className="stat-foot">
                包含本机及网卡监听地址
                <ArrowUpRight size={14} />
              </span>
            </button>
            <div className="stat-card">
              <div>
                <span className="stat-label">关联进程</span>
                <div className="stat-number">
                  {snapshot ? String(processCount).padStart(2, '0') : '—'}
                  <span className="stat-note">独立进程</span>
                </div>
              </div>
              <div className="stat-icon cream">
                <SquareTerminal size={21} />
              </div>
              <span className="stat-foot">
                同一进程可能占用多个端口
                <ShieldCheck size={14} />
              </span>
            </div>
          </section>

          {scanError && (
            <div className="error-banner">
              <CircleHelp size={18} />
              <div>
                <strong>暂时无法读取端口</strong>
                <p>
                  {scanError}
                  {snapshot ? ' 当前保留的是上次扫描结果。' : ''}
                </p>
              </div>
              <button onClick={() => void refresh()} disabled={loading}>
                重新扫描
                <RefreshCw size={14} />
              </button>
            </div>
          )}
          {!!snapshot?.warnings.length && (
            <div className="warning-banner">
              <CircleHelp size={16} />
              <span>{snapshot.warnings.join(' ')}</span>
            </div>
          )}

          {view === 'activity' ? (
            <section className="activity-panel">
              <div className="section-heading">
                <h2>
                  最近活动<span>{logs.length}</span>
                </h2>
                <button className="text-button" onClick={() => setLogs([])} disabled={!logs.length}>
                  清空记录
                </button>
              </div>
              {logs.length ? (
                <div className="activity-list">
                  {logs.map((log) => (
                    <div className="activity-row" key={log.id}>
                      <div className={`activity-icon ${log.type}`}>
                        {log.type === 'stop' ? (
                          <Square size={15} />
                        ) : log.type === 'scan' ? (
                          <Search size={17} />
                        ) : (
                          <Activity size={18} />
                        )}
                      </div>
                      <div>
                        <strong>{log.title}</strong>
                        <p>{log.detail}</p>
                      </div>
                      <time>{clock(log.time)}</time>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<Clock3 size={28} />}
                  title="这里还很安静"
                  text="服务变化和进程操作会出现在这里。"
                />
              )}
            </section>
          ) : (
            <section className="services-panel">
              <div className="section-heading">
                <div className="section-title">
                  <h2>
                    {view === 'favorites' ? '已收藏的服务' : '服务列表'}
                    <span>{visible.length}</span>
                  </h2>
                  <span className="section-description">
                    {view === 'favorites' ? '显示当前在线的收藏' : '掌握每一个运行中的项目'}
                  </span>
                </div>
                <button
                  className={`auto-refresh ${isAuto ? '' : 'paused'}`}
                  onClick={() => (settings.interval ? setPaused(!paused) : setSettingsOpen(true))}
                  title={isAuto ? '点击暂停自动刷新' : '点击恢复自动刷新'}
                >
                  <span className="status-dot" />
                  {isAuto ? `每 ${settings.interval} 秒刷新` : '自动刷新已暂停'}
                  {isAuto ? <Pause size={12} /> : <Play size={12} />}
                </button>
              </div>
              <div className="filter-bar">
                <div className="tabs" role="group" aria-label="服务分类">
                  {view === 'services' ? (
                    <>
                      <button
                        className={category === 'development' ? 'active' : ''}
                        onClick={() => {
                          setCategory('development')
                          setSelected([])
                        }}
                      >
                        开发服务<span>{devCount}</span>
                      </button>
                      <button
                        className={category === 'all' ? 'active' : ''}
                        onClick={() => {
                          setCategory('all')
                          setSelected([])
                        }}
                      >
                        全部端口
                      </button>
                      <button
                        className={category === 'system' ? 'active' : ''}
                        onClick={() => {
                          setCategory('system')
                          setSelected([])
                        }}
                      >
                        系统服务
                      </button>
                    </>
                  ) : (
                    <span className="favorites-label">
                      <Star size={14} />
                      已收藏
                    </span>
                  )}
                </div>
                <div className="filter-tools">
                  <label className="search-box">
                    <Search size={15} />
                    <input
                      ref={searchRef}
                      placeholder="搜索项目、端口或 PID…"
                      aria-label="搜索项目、端口或 PID"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query ? (
                      <button aria-label="清除搜索" onClick={() => setQuery('')}>
                        <X size={13} />
                      </button>
                    ) : (
                      <kbd>Ctrl K</kbd>
                    )}
                  </label>
                  <label className="select-wrap">
                    <ListFilter size={14} />
                    <select
                      aria-label="端口协议"
                      value={protocol}
                      onChange={(e) => setProtocol(e.target.value)}
                    >
                      <option value="all">全部协议</option>
                      <option value="TCP">TCP</option>
                      {settings.includeUdp && <option value="UDP">UDP</option>}
                    </select>
                    <ChevronDown size={12} />
                  </label>
                  <button
                    className="icon-button filter-settings"
                    aria-label="显示设置"
                    title="显示设置"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <SlidersHorizontal size={16} />
                  </button>
                </div>
              </div>
              {selectedServices.length > 0 && (
                <div className="selection-bar">
                  <span>
                    <CheckCheck size={15} />
                    已选择 {selectedServices.length} 个服务
                  </span>
                  <button className="text-button" onClick={() => requestStop(selectedServices)}>
                    <Square size={12} />
                    结束所选进程
                  </button>
                  <button
                    className="icon-button"
                    aria-label="取消选择"
                    onClick={() => setSelected([])}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="checkbox-cell">
                        <input
                          type="checkbox"
                          aria-label="选择所有可结束的服务"
                          checked={allChecked}
                          disabled={!eligible.length}
                          onChange={() => setSelected(allChecked ? [] : eligible.map((s) => s.id))}
                        />
                      </th>
                      <th className="project-col">
                        <button onClick={() => setSort(sort === 'name' ? 'port' : 'name')}>
                          项目 / 进程{sort === 'name' && <ArrowDown size={12} />}
                        </button>
                      </th>
                      <th className="port-col">
                        <button onClick={() => setSort('port')}>
                          端口{sort === 'port' && <ArrowDown size={12} />}
                        </button>
                      </th>
                      <th className="status-col">状态</th>
                      <th className="pid-col">PID</th>
                      <th className="uptime-col">
                        <button onClick={() => setSort(sort === 'time' ? 'port' : 'time')}>
                          运行时长{sort === 'time' && <ArrowDown size={12} />}
                        </button>
                      </th>
                      <th className="actions-col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !snapshot
                      ? Array.from({ length: 5 }, (_, i) => (
                          <tr key={i} className="skeleton-row">
                            <td />
                            <td>
                              <div className="skeleton" />
                            </td>
                            <td>
                              <div className="skeleton short" />
                            </td>
                            <td>
                              <div className="skeleton short" />
                            </td>
                            <td />
                            <td />
                            <td />
                          </tr>
                        ))
                      : visible.map((service) => (
                          <tr
                            key={service.id}
                            className={`${selected.includes(service.id) ? 'checked-row' : ''} ${detailId === service.id ? 'detail-row' : ''}`}
                          >
                            <td className="checkbox-cell">
                              <input
                                type="checkbox"
                                aria-label={`选择 ${service.name} ${service.port}`}
                                title={service.protectedReason ?? `选择 ${service.name}`}
                                disabled={!!service.protectedReason}
                                checked={selected.includes(service.id)}
                                onChange={(e) =>
                                  setSelected((ids) =>
                                    e.target.checked
                                      ? [...ids, service.id]
                                      : ids.filter((id) => id !== service.id),
                                  )
                                }
                              />
                            </td>
                            <td className="project-cell">
                              <button
                                className="project-button"
                                onClick={() => setDetailId(service.id)}
                              >
                                <FrameworkIcon service={service} />
                                <div>
                                  <div className="project-name">
                                    <strong>{service.name}</strong>
                                    {service.framework && (
                                      <span
                                        className={`framework-label ${service.framework === 'Vite' ? 'vite-label' : ''}`}
                                      >
                                        {service.framework}
                                      </span>
                                    )}
                                    {favorites.includes(favoriteKey(service)) && (
                                      <Star
                                        size={11}
                                        className="favorite-indicator"
                                        fill="currentColor"
                                      />
                                    )}
                                  </div>
                                  <div
                                    className="project-path"
                                    title={
                                      service.projectPath ??
                                      service.executablePath ??
                                      '项目路径无法识别'
                                    }
                                  >
                                    {service.projectPath ? (
                                      <Folder size={11} />
                                    ) : (
                                      <SquareTerminal size={11} />
                                    )}
                                    <span>{service.projectPath ?? service.processName}</span>
                                  </div>
                                </div>
                              </button>
                            </td>
                            <td>
                              <button
                                className="port-pill"
                                title="复制端口"
                                onClick={() =>
                                  void run(
                                    () => api.copyText(String(service.port)),
                                    `端口 ${service.port} 已复制`,
                                  )
                                }
                              >
                                <span>:</span>
                                {service.port}
                              </button>
                              <small className="protocol-label">{service.protocol}</small>
                            </td>
                            <td>
                              <span className="list-status">
                                <span className="status-dot" />
                                {service.protocol === 'TCP' ? '监听中' : '已绑定'}
                              </span>
                              {service.scope !== 'local' && (
                                <span className="scope-label">
                                  {service.scope === 'network' ? '所有网卡' : '指定网卡'}
                                </span>
                              )}
                            </td>
                            <td className="pid-cell">{service.pid}</td>
                            <td className="uptime-cell">{elapsed(service.startedAt)}</td>
                            <td className="row-actions">
                              <button
                                className="icon-button open-service"
                                aria-label={`打开 ${service.name} ${service.port}`}
                                title={
                                  service.url
                                    ? '在浏览器打开（按 HTTP/HTTPS 尝试）'
                                    : 'UDP 端口不支持网页访问'
                                }
                                disabled={!service.url}
                                onClick={() => void run(() => api.openUrl(service.id))}
                              >
                                <ExternalLink size={15} />
                              </button>
                              <button
                                className="icon-button stop-service"
                                aria-label={`结束 ${service.name} ${service.port}`}
                                title={service.protectedReason ?? '结束进程'}
                                disabled={!!service.protectedReason}
                                onClick={() => requestStop([service])}
                              >
                                {service.protectedReason ? (
                                  <ShieldCheck size={16} />
                                ) : (
                                  <Square size={14} />
                                )}
                              </button>
                              <div className="menu-container">
                                <button
                                  className={`icon-button ${rowMenu === service.id ? 'menu-active' : ''}`}
                                  aria-label={`更多操作 ${service.name} ${service.port}`}
                                  title="更多操作"
                                  aria-expanded={rowMenu === service.id}
                                  onClick={() =>
                                    setRowMenu(rowMenu === service.id ? null : service.id)
                                  }
                                >
                                  <Ellipsis size={19} />
                                </button>
                                {rowMenu === service.id && (
                                  <>
                                    <div
                                      className="menu-dismiss"
                                      onClick={() => setRowMenu(null)}
                                    />
                                    <div className="row-menu">
                                      <button
                                        onClick={() => {
                                          setDetailId(service.id)
                                          setRowMenu(null)
                                        }}
                                      >
                                        <SquareTerminal size={14} />
                                        查看详情
                                      </button>
                                      <button
                                        onClick={() => {
                                          toggleFavorite(service)
                                          setRowMenu(null)
                                        }}
                                      >
                                        <Star size={14} />
                                        {favorites.includes(favoriteKey(service))
                                          ? '取消收藏'
                                          : '收藏服务'}
                                      </button>
                                      <button
                                        disabled={!service.projectPath}
                                        onClick={() => {
                                          setRowMenu(null)
                                          void run(() => api.openFolder(service.id))
                                        }}
                                      >
                                        <Folder size={14} />
                                        打开项目目录
                                      </button>
                                      <button
                                        disabled={!service.url}
                                        onClick={() => {
                                          setRowMenu(null)
                                          void run(
                                            () => api.copyText(service.url!),
                                            '访问地址已复制',
                                          )
                                        }}
                                      >
                                        <Copy size={14} />
                                        复制访问地址
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
              {!loading && visible.length === 0 && (
                <Empty
                  icon={view === 'favorites' ? <Star size={28} /> : <Search size={28} />}
                  title={
                    query
                      ? '没有找到匹配的服务'
                      : view === 'favorites'
                        ? '把常用服务留在这里'
                        : '这里暂时没有运行中的服务'
                  }
                  text={
                    query
                      ? '试试项目名、端口号、进程 ID，或清空筛选。'
                      : view === 'favorites'
                        ? '在服务的更多操作中点击「收藏服务」，下次就能快速找到。'
                        : category === 'development'
                          ? '启动一个开发项目后刷新，或切换到全部端口查看。'
                          : '稍后刷新，或调整协议筛选。'
                  }
                  action={
                    query ? (
                      <button
                        className="button secondary"
                        onClick={() => {
                          setQuery('')
                          setProtocol('all')
                        }}
                      >
                        清空筛选
                      </button>
                    ) : view === 'services' && category !== 'all' ? (
                      <button className="button secondary" onClick={() => setCategory('all')}>
                        查看全部端口
                        <ArrowRight size={14} />
                      </button>
                    ) : undefined
                  }
                />
              )}
              <div className="table-footer">
                <span>
                  显示 {visible.length} 项<span className="footer-divider">/</span>
                  {settings.includeUdp ? 'TCP 监听与 UDP 绑定' : 'TCP 监听端口'}
                  <span className="footer-divider">·</span>IPv4 / IPv6 已合并
                </span>
                <span>
                  <ShieldCheck size={13} />
                  系统进程受保护
                </span>
              </div>
            </section>
          )}
          <div className="workspace-footer">
            <span>
              <span className={`status-dot ${scanError ? 'bad' : ''}`} />
              {scanError
                ? '扫描异常'
                : loading
                  ? '正在扫描本机端口'
                  : `上次更新 ${snapshot ? clock(snapshot.scannedAt) : '—'}`}
              {snapshot && (
                <span className="duration">用时 {(snapshot.durationMs / 1000).toFixed(1)}s</span>
              )}
            </span>
            <button onClick={() => setHelpOpen(true)}>
              <CircleHelp size={14} />
              关于端口与进程
              <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="quiet-note">
            <span />A little clarity for your localhost.
            <span />
          </div>
        </main>
      </div>

      {detailId && (
        <>
          <div className="drawer-backdrop" onClick={() => setDetailId(null)} />
          <aside className="detail-drawer" aria-label="服务详情">
            <header>
              <span>服务详情</span>
              <button
                className="icon-button"
                aria-label="关闭详情"
                onClick={() => setDetailId(null)}
              >
                <X size={20} />
              </button>
            </header>
            {detail ? (
              <>
                <div className="detail-intro">
                  <FrameworkIcon service={detail} large />
                  <button
                    className={`icon-button detail-star ${favorites.includes(favoriteKey(detail)) ? 'starred' : ''}`}
                    aria-label={favorites.includes(favoriteKey(detail)) ? '取消收藏' : '收藏服务'}
                    onClick={() => toggleFavorite(detail)}
                  >
                    <Star
                      size={19}
                      fill={favorites.includes(favoriteKey(detail)) ? 'currentColor' : 'none'}
                    />
                  </button>
                </div>
                <h2>{detail.name}</h2>
                <div className="detail-badges">
                  <span className="list-status">
                    <span className="status-dot" />
                    {detail.protocol === 'TCP' ? '监听中' : '已绑定'}
                  </span>
                  <span>{detail.framework ?? detail.processName}</span>
                  <span>{detail.protocol}</span>
                </div>
                <div className="detail-url">
                  <Globe2 size={17} />
                  <code>{detail.url ?? `UDP :${detail.port}`}</code>
                  <button
                    className="icon-button"
                    aria-label="复制地址"
                    onClick={() =>
                      void run(() => api.copyText(detail.url ?? String(detail.port)), '已复制')
                    }
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <div className="detail-quick-actions">
                  <button
                    className="button primary"
                    disabled={!detail.url}
                    onClick={() => void run(() => api.openUrl(detail.id))}
                  >
                    打开页面
                    <ArrowUpRight size={15} />
                  </button>
                  <button
                    className="button secondary"
                    disabled={!detail.projectPath}
                    onClick={() => void run(() => api.openFolder(detail.id))}
                  >
                    <Folder size={15} />
                    项目目录
                  </button>
                </div>
                <div className="detail-section">
                  <h3>进程信息</h3>
                  <dl>
                    <div>
                      <dt>进程 ID</dt>
                      <dd className="mono">{detail.pid}</dd>
                    </div>
                    <div>
                      <dt>可执行进程</dt>
                      <dd>{detail.processName}</dd>
                    </div>
                    <div>
                      <dt>父进程 ID</dt>
                      <dd className="mono">{detail.parentPid ?? '未知'}</dd>
                    </div>
                    <div>
                      <dt>运行时长</dt>
                      <dd>{elapsed(detail.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>内存占用</dt>
                      <dd>
                        {detail.memoryMB === null ? '未知' : `${detail.memoryMB.toFixed(1)} MB`}
                      </dd>
                    </div>
                    <div>
                      <dt>监听范围</dt>
                      <dd>
                        {detail.scope === 'local'
                          ? '仅本机'
                          : detail.scope === 'network'
                            ? '所有网卡'
                            : '指定网卡'}
                      </dd>
                    </div>
                    <div>
                      <dt>绑定地址</dt>
                      <dd className="mono addresses">
                        {detail.addresses.map((address) => (
                          <span key={address}>{address}</span>
                        ))}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="detail-section">
                  <h3>项目路径{detail.projectSource === 'parent' && <span>从父进程推断</span>}</h3>
                  <div className="path-box">
                    <Folder size={15} />
                    <code>{detail.projectPath ?? '此进程的项目目录暂时无法识别'}</code>
                  </div>
                </div>
                <div className="detail-section">
                  <h3>
                    启动命令
                    {detail.commandLine && (
                      <button
                        className="icon-button"
                        aria-label="复制启动命令"
                        onClick={() =>
                          void run(() => api.copyText(detail.commandLine!), '启动命令已复制')
                        }
                      >
                        <Copy size={13} />
                      </button>
                    )}
                  </h3>
                  <pre>{detail.commandLine ?? '当前权限下无法读取启动命令。'}</pre>
                </div>
                <div className="detail-hint">
                  <CircleHelp size={15} />
                  <p>
                    同一 PID 的所有端口会一起释放。网页地址根据监听地址推断，服务可能使用其他协议。
                  </p>
                </div>
                <button
                  className="button danger-outline detail-stop"
                  disabled={!!detail.protectedReason}
                  onClick={() => requestStop([detail])}
                >
                  {detail.protectedReason ? <ShieldCheck size={16} /> : <Square size={14} />}
                  {detail.protectedReason ?? '结束这个进程'}
                </button>
              </>
            ) : (
              <Empty
                icon={<Check size={28} />}
                title="服务已离线"
                text="这个端口已释放，或进程已退出。"
              />
            )}
          </aside>
        </>
      )}

      {!!stopTargets.length && (
        <Modal
          title={`结束 ${stopTargets.length === 1 ? '这个' : stopTargets.length + ' 个'}进程？`}
          onClose={() => {
            if (!stopping) setStopTargets([])
          }}
        >
          <div className="stop-warning">
            <div>
              <Square size={21} />
            </div>
            <p>对应的服务会立即停止，进程中未保存的状态可能丢失。可以在原项目终端重新启动。</p>
          </div>
          <div className="stop-list">
            {stopTargets.map((s) => (
              <div key={s.id}>
                <FrameworkIcon service={s} />
                <div>
                  <strong>{s.name}</strong>
                  <span>
                    PID {s.pid} · 端口{' '}
                    {all
                      .filter((p) => p.pid === s.pid)
                      .map((p) => p.port)
                      .join('、')}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={includeChildren}
              onChange={(e) => setIncludeChildren(e.target.checked)}
              disabled={stopping}
            />
            <span>
              同时结束此进程的子进程<small>仅处理该 PID 及其子进程，不会结束父终端。</small>
            </span>
          </label>
          {!api.isDesktop && (
            <p className="preview-stop-note">当前为界面预览，此操作只移除示例数据。</p>
          )}
          <footer>
            <button
              className="button secondary"
              disabled={stopping}
              onClick={() => setStopTargets([])}
            >
              取消
            </button>
            <button
              className="button danger"
              disabled={stopping}
              onClick={() => void confirmStop()}
            >
              {stopping ? <LoaderCircle size={15} className="spin" /> : <Square size={13} />}
              {stopping ? '正在结束…' : '确认结束进程'}
            </button>
          </footer>
        </Modal>
      )}

      {settingsOpen && (
        <Modal title="偏好设置" onClose={() => setSettingsOpen(false)}>
          <p className="modal-description">让这个工作空间，更适合你的习惯。</p>
          <div className="setting-row">
            <div>
              <strong>自动刷新</strong>
              <p>窗口在前台时自动检查端口变化</p>
            </div>
            <select
              aria-label="自动刷新间隔"
              value={settings.interval}
              onChange={(e) => {
                setSettings((s) => ({ ...s, interval: Number(e.target.value) }))
                setPaused(false)
              }}
            >
              <option value={5}>每 5 秒</option>
              <option value={10}>每 10 秒</option>
              <option value={30}>每 30 秒</option>
              <option value={0}>关闭</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>显示 UDP 端口</strong>
              <p>默认只显示 TCP 监听端口</p>
            </div>
            <button
              className={`toggle ${settings.includeUdp ? 'on' : ''}`}
              role="switch"
              aria-label="显示 UDP 端口"
              aria-checked={settings.includeUdp}
              onClick={() => {
                setSettings((s) => ({ ...s, includeUdp: !s.includeUdp }))
                setProtocol('all')
              }}
            >
              <span />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>紧凑列表</strong>
              <p>在同一屏幕中显示更多服务</p>
            </div>
            <button
              className={`toggle ${settings.compact ? 'on' : ''}`}
              role="switch"
              aria-label="紧凑列表"
              aria-checked={settings.compact}
              onClick={() => setSettings((s) => ({ ...s, compact: !s.compact }))}
            >
              <span />
            </button>
          </div>
          <div className="settings-note">
            <ShieldCheck size={17} />
            <span>设置和收藏仅保存在这台电脑，不上传任何进程信息。</span>
          </div>
          <footer>
            <span className="saved-label">
              <Check size={13} />
              自动保存
            </span>
            <button className="button primary" onClick={() => setSettingsOpen(false)}>
              完成
            </button>
          </footer>
        </Modal>
      )}

      {helpOpen && (
        <Modal title="关于端口与进程" onClose={() => setHelpOpen(false)}>
          <div className="help-content">
            <h3>为什么有些服务不是 127.0.0.1？</h3>
            <p>
              0.0.0.0 和 :: 表示监听所有网卡；::1 是 IPv6
              本机地址。同一进程、协议与端口的多个地址会合并显示。
            </p>
            <h3>项目名称从哪里来？</h3>
            <p>
              Portlight 从启动命令和父进程推断目录，再读取 package.json
              的名称。部分程序不暴露目录，会显示进程名。它不会扫描整个磁盘。
            </p>
            <h3>结束进程会影响什么？</h3>
            <p>
              同一个 PID 的全部端口都会停止。系统进程、Portlight
              自身及无法核实身份的进程受到保护。端口快照包括项目路径和启动命令，分享前请检查内容。
            </p>
            <h3>范围与限制</h3>
            <p>
              当前显示 Windows 主机上的 TCP 监听和可选的 UDP 绑定。WSL、Docker
              内部项目名称不一定能直接识别；网页地址也不代表已验证 HTTP 服务。
            </p>
          </div>
          <footer>
            <button className="button primary" onClick={() => setHelpOpen(false)}>
              知道了
            </button>
          </footer>
        </Modal>
      )}

      <div className="toast-stack" aria-live="polite">
        {notices.map((notice) => (
          <div className={`toast ${notice.error ? 'error' : ''}`} key={notice.id}>
            {notice.error ? <CircleHelp size={17} /> : <Check size={17} />}
            <span>{notice.message}</span>
            <button
              aria-label="关闭提示"
              onClick={() => setNotices((n) => n.filter((t) => t.id !== notice.id))}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}
