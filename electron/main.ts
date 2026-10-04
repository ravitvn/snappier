import { app, BrowserWindow, ipcMain, globalShortcut, screen, desktopCapturer, systemPreferences, shell } from 'electron'
import { join } from 'path'
import https from 'https'
import http from 'http'
import { createWriteStream } from 'fs'
import { tmpdir } from 'os'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 720,
    minWidth: 500,
    minHeight: 400,
    show: true,
    frame: false,
    transparent: false,
    backgroundColor: '#f0f9ff',
    alwaysOnTop: false,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow!.focus())

  mainWindow.webContents.on('before-input-event', (_, input) => {
    const isDevShortcut =
      (process.platform === 'darwin' && input.meta && input.alt && input.key === 'i') ||
      (process.platform !== 'darwin' && input.control && input.shift && input.key === 'I')
    if (isDevShortcut) mainWindow!.webContents.toggleDevTools()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  // Global screenshot shortcut Ctrl+Alt+S
  globalShortcut.register('CommandOrControl+Alt+S', () => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('trigger-screenshot')
  })

  // Toggle show/hide with Ctrl+Shift+S
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('capture-screen', async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen')
    if (status === 'denied') return '__permission_denied__'
  }
  try {
    const { width, height } = screen.getPrimaryDisplay().size
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.min(width, 1280), height: Math.min(height, 800) },
    })
    const thumb = sources[0]?.thumbnail
    if (!thumb || thumb.isEmpty()) return '__needs_permission__'
    return `data:image/jpeg;base64,${thumb.toJPEG(85).toString('base64')}`
  } catch {
    return '__needs_permission__'
  }
})

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    protocol.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.resume()
        downloadFile(res.headers.location, dest).then(resolve).catch(reject)
        return
      }
      const total = parseInt(res.headers['content-length'] ?? '0', 10)
      let received = 0
      const file = createWriteStream(dest)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total > 0) mainWindow?.webContents.send('download-progress', Math.round((received / total) * 100))
      })
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
      file.on('error', reject)
      res.on('error', reject)
    }).on('error', reject)
  })
}

ipcMain.handle('download-update', async (_e, url: string) => {
  try {
    const fileName = url.split('/').pop() ?? 'SnappierUpdate'
    const dest = join(tmpdir(), fileName)
    await downloadFile(url, dest)
    await shell.openPath(dest)
    setTimeout(() => app.quit(), 3000)
    return { ok: true }
  } catch (e) {
    return { error: String(e) }
  }
})

ipcMain.handle('minimize-window', () => mainWindow?.minimize())
ipcMain.handle('close-window', () => mainWindow?.close())
ipcMain.handle('open-url', (_e, url: string) => shell.openExternal(url))
