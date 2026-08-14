import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { registerIpc } from './ipc'
import { detachAll, initServers, liveRunCount, stopAll } from './servers'

let mainWindow: BrowserWindow | null = null
/** Set once the user has chosen to quit, so the close handler stops intercepting. */
let quitting = false

function assetPath(file: string): string {
  // Packaged builds resolve against resources/; development against build/.
  const packaged = path.join(process.resourcesPath, file)
  if (app.isPackaged && existsSync(packaged)) return packaged
  return path.join(__dirname, '../../build', file)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    title: 'NPM Server Manager',
    icon: assetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Closing the window is a decision about the running servers, so it asks
  // rather than assuming. See docs/DECISIONS.md §12.
  mainWindow.on('close', (event) => {
    if (quitting) return
    const live = liveRunCount()
    if (live === 0) return // nothing at stake; let it close normally

    event.preventDefault()
    void askOnClose(live)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Anything trying to open a new window goes to the real browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    // Packaged builds load the bundled files straight off disk -- no local server.
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

async function askOnClose(live: number): Promise<void> {
  if (!mainWindow) return

  const plural = live === 1 ? 'server' : 'servers'
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Quit NPM Server Manager',
    message: `Stop the ${live} running dev ${plural}?`,
    detail: `Leaving them running keeps your ports bound after the app closes.`,
    buttons: ['Stop servers and quit', 'Leave them running', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })

  if (response === 2) return

  quitting = true
  if (response === 0) await stopAll()
  app.quit()
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// A second launch should focus the existing window rather than start a rival
// instance that would fight over the same tracked processes.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(() => {
    // Load the record of servers left running by a previous session; the first
    // port scan validates them against live processes and reattaches.
    initServers()
    registerIpc(() => mainWindow)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showWindow()
    })
  })

  app.on('window-all-closed', () => {
    // The close handler either quits or cancels, so reaching here means the
    // window really closed.
    app.quit()
  })

  // Servers this app started keep running unless the user asked otherwise; all
  // that is needed here is to stop tailing and write out the run index.
  app.on('before-quit', () => {
    quitting = true
    detachAll()
  })

}
