import { app, shell, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { Readable } from 'stream'
import { initDb } from './db'
import { registerIpc } from './ipc'
import { resumePending } from './importer'
import { serve as servePreview, detach as detachPreview, killAll as killAllPreview } from './preview'

// 自定义协议：渲染层用 media://file/<encoded-abs-path> 读取本地缩略图与视频（支持 range 流式播放）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true }
  }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ececee',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))

    // media://stream/<encoded path> —— 按需分段转码（HEVC/10bit → 720p H.264），由 preview.ts
    // 的内存缓存供流：即时回放已预取的前 15s 再 live 直通，绝不落盘、不改源文件。
    // 进程生命周期交给 preview.reconcile；这里 abort 只解绑下游消费者。
    if (url.host === 'stream') {
      const pass = servePreview(filePath)
      const onAbort = (): void => detachPreview(filePath, pass)
      if (request.signal.aborted) onAbort()
      else request.signal.addEventListener('abort', onAbort, { once: true })

      const body = Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>
      return new Response(body, {
        status: 200,
        // 流式转码无法预知总长/任意 range，统一 200 渐进播放
        headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' }
      })
    }

    // media://file/<encoded path> —— 静态文件（缩略图、可直接硬解的原片），net.fetch 支持 range 流式
    return net.fetch(pathToFileURL(filePath).toString())
  })

  initDb()
  registerIpc()
  createWindow()
  void resumePending()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllPreview() // 没有窗口就不会有预览，清掉转码进程
  if (process.platform !== 'darwin') app.quit()
})

// 退出前杀掉所有预览转码进程，避免被 SIGSTOP 暂停的 ffmpeg 变成孤儿残留
app.on('before-quit', killAllPreview)
