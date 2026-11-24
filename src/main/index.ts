import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, screen, session, shell } from 'electron'
import { closeDb, getDb } from './db'
import { attachDevHarness, prepareHarness } from './devharness'
import { resumeJobs } from './generation'
import { registerIpc } from './ipc'
import { activeJobCount, cancelAllJobs } from './jobs'
import { handleStudioProtocol, registerSchemes } from './protocol'
import { warmUpEncryption } from './secrets'
import { readCache, writeCache } from './settings'

/**
 * The app used to be called "Studio Cerita". Its data folder (projects, database, saved keys) moves to the
 * new name once. If the old folder is busy, for example while an old build still runs, it is used as is.
 */
function useDataFolder(): void {
  if (!app.isPackaged && process.env.STUDIO_USER_DATA) return app.setPath('userData', process.env.STUDIO_USER_DATA)
  const appData = app.getPath('appData')
  const current = join(appData, 'Bang Story')
  const legacy = join(appData, 'Studio Cerita')
  if (!existsSync(current) && existsSync(join(legacy, 'studio.db'))) {
    try {
      renameSync(legacy, current)
    } catch {
      return app.setPath('userData', legacy)
    }
  }
  app.setPath('userData', current)
}

useDataFolder()
prepareHarness()
// Windows hands videos to hardware overlays that snap their size and position to whole pixels, so a slow
// camera move over a video trembles while the same move over a still is smooth. Draw videos like images.
app.commandLine.appendSwitch('disable-direct-composition-video-overlays')

registerSchemes()

/**
 * YouTube only plays embedded videos for embedders that identify themselves with an HTTP Referer, and a
 * page loaded from file:// sends none (the player then shows error 153). The app identifies itself with
 * its app ID, as YouTube asks of apps that are not websites.
 */
function identifyToYouTube(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*'] }, (details, done) => {
    done({ requestHeaders: { ...details.requestHeaders, Referer: 'https://id.bangtutorial.bangstory/' } })
  })
}

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

function loadWindowState(): WindowState {
  const fallback: WindowState = { width: 1440, height: 900 }
  try {
    const saved = readCache<WindowState>('window:bounds')?.value
    if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return fallback
    const width = Math.max(1180, Math.round(saved.width))
    const height = Math.max(720, Math.round(saved.height))
    if (typeof saved.x === 'number' && typeof saved.y === 'number' && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const display = screen.getDisplayMatching({ x: saved.x, y: saved.y, width, height })
      const area = display.workArea
      const visible = saved.x < area.x + area.width - 80 && saved.x + width > area.x + 80 && saved.y < area.y + area.height - 80 && saved.y + height > area.y + 40
      if (visible) return { x: Math.round(saved.x), y: Math.round(saved.y), width, height, maximized: saved.maximized === true }
    }
    return { width, height, maximized: saved.maximized === true }
  } catch {
    return fallback
  }
}

function createWindow(): void {
  const initial = loadWindowState()
  const win = new BrowserWindow({
    x: initial.x,
    y: initial.y,
    width: initial.width,
    height: initial.height,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#FAF7F2',
    autoHideMenuBar: true,
    title: 'Bang Story',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => {
    if (initial.maximized) win.maximize()
    win.show()
  })

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const persistBounds = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return
    const maximized = win.isMaximized()
    const b = maximized ? win.getNormalBounds() : win.getBounds()
    try {
      writeCache('window:bounds', { x: b.x, y: b.y, width: b.width, height: b.height, maximized })
    } catch {
      /* Window state persistence is best-effort. */
    }
  }
  const scheduleBoundsSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistBounds, 400)
  }
  win.on('resize', scheduleBoundsSave)
  win.on('move', scheduleBoundsSave)
  win.on('maximize', scheduleBoundsSave)
  win.on('unmaximize', scheduleBoundsSave)

  let forceClosing = false
  win.on('close', (e) => {
    if (saveTimer) clearTimeout(saveTimer)
    persistBounds()
    if (!forceClosing && !process.env.STUDIO_CAPTURE_PLAN && activeJobCount() > 0) {
      e.preventDefault()
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Batal', 'Tetap tutup'],
        defaultId: 0,
        cancelId: 0,
        title: 'Masih ada proses berjalan',
        message: 'Ekspor atau pembuatan konten masih berjalan di latar belakang.',
        detail: 'Jika kamu menutup aplikasi sekarang, proses yang sedang berjalan akan dibatalkan.'
      })
      if (choice === 1) {
        forceClosing = true
        cancelAllJobs()
        win.close()
      }
    }
  })

  identifyToYouTube()
  attachDevHarness(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) e.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const single = app.requestSingleInstanceLock()
if (!single) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('id.bangtutorial.bangstory')
    warmUpEncryption()
    getDb()
    handleStudioProtocol()
    registerIpc()
    createWindow()
    resumeJobs()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    cancelAllJobs()
    closeDb()
  })
}
