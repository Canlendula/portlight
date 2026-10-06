import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PortServiceManager } from './service'

let window: BrowserWindow | null = null
const devUrl = !app.isPackaged ? process.env.PORTLIGHT_DEV_URL : undefined
const entry = path.join(__dirname, '../dist/index.html')
const manager = new PortServiceManager(
  app.isPackaged ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname,
  devUrl ? process.ppid : process.pid,
)
const allowedUrl = devUrl ? new URL(devUrl).origin : pathToFileURL(entry).href

function assertSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error('Untrusted IPC sender')
  const url = event.senderFrame?.url ?? ''
  if (devUrl ? new URL(url).origin !== allowedUrl : url.split('#')[0] !== allowedUrl)
    throw new Error('Untrusted IPC origin')
}

function handle(channel: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    assertSender(event)
    return callback(...args)
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(() => {
    handle('ports:scan', () => manager.scan())
    handle('ports:stop', (request) => manager.stop(request))
    handle('ports:open-url', async (id) => {
      const service = manager.getService(id)
      if (!service.url) throw new Error('UDP 端口没有网页地址。')
      const url = new URL(service.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('不支持的地址。')
      await shell.openExternal(url.href)
    })
    handle('ports:open-folder', async (id) => {
      const folder = manager.getService(id).projectPath
      if (!folder || !path.isAbsolute(folder) || !(await stat(folder)).isDirectory())
        throw new Error('项目目录不存在或无法访问。')
      const error = await shell.openPath(folder)
      if (error) throw new Error('无法打开项目目录。')
    })
    handle('clipboard:write', (text: unknown) => {
      if (typeof text !== 'string' || text.length > 100000) throw new Error('无效的剪贴板内容。')
      clipboard.writeText(text)
    })
    handle('ports:export', async () => {
      const snapshot = manager.getSnapshot()
      if (!snapshot || !window) throw new Error('请先扫描端口。')
      const result = await dialog.showSaveDialog(window, {
        title: '导出端口快照',
        defaultPath: `portlight-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, JSON.stringify(snapshot, null, 2), 'utf8')
      return true
    })
    ipcMain.on('window:action', (event, action) => {
      assertSender(event)
      if (action === 'minimize') window?.minimize()
      if (action === 'maximize') window?.isMaximized() ? window.unmaximize() : window?.maximize()
      if (action === 'close') window?.close()
    })
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 940,
      minHeight: 660,
      frame: false,
      show: false,
      backgroundColor: '#f6f7f9',
      title: 'Portlight',
      icon: path.join(__dirname, '../dist/icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    )
    window.once('ready-to-show', () => window?.show())
    window.on('closed', () => {
      window = null
    })
    if (devUrl) void window.loadURL(devUrl)
    else void window.loadFile(entry)
  })
}
app.on('window-all-closed', () => app.quit())
