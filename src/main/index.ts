import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { registerIpc } from './ipc'
import { detachAll, initServers, liveRunCount, stopAll } from './servers'

let mainWindow: BrowserWindow | null = null
/** Set once the user has chosen to quit, so the close handler stops intercepting. */
let quitting = false
/** True while the in-app quit dialog is waiting for an answer. */
let awaitingQuitChoice = false
let quitFallbackTimer: NodeJS.Timeout | null = null

// A development run gets its own data directory. Two consequences, both wanted:
// the single-instance lock no longer collides with an installed copy (dev used to
// quit instantly and silently while the real app was open), and a dev session
// cannot corrupt the real projects.json or runs.json -- two instances writing the
// same run index would fight over which servers exist.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

function assetPath(file: string): string {
  // Packaged builds resolve against resources/; development against build/.
  const packaged = path.join(process.resourcesPath, file)
  if (app.isPackaged && existsSync(packaged)) return packaged
  return path.join(__dirname, '../../build', file)
}

// autoHideMenuBar only hides the menu until Alt is pressed. The app has no menu
// commands of its own, so the default template is removed outright.
Menu.setApplicationMenu(null)

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
    if (awaitingQuitChoice) return
    awaitingQuitChoice = true

    mainWindow?.webContents.send('app:confirm-quit', { liveRuns: live })

    // If the renderer cannot answer -- crashed, or still loading -- fall back to
    // the OS dialog rather than leaving a window that refuses to close.
    quitFallbackTimer = setTimeout(() => {
      if (!awaitingQuitChoice) return
      awaitingQuitChoice = false
      void askOnCloseNative(live)
    }, 6000)
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

/** Applies the choice made in the in-app dialog. */
export async function resolveQuitChoice(choice: 'stop' | 'leave' | 'cancel'): Promise<void> {
  if (quitFallbackTimer) {
    clearTimeout(quitFallbackTimer)
    quitFallbackTimer = null
  }
  awaitingQuitChoice = false
  if (choice === 'cancel') return

  quitting = true
  if (choice === 'stop') await stopAll()
  app.quit()
}

/** Only used when the renderer is unable to present the in-app dialog. */
async function askOnCloseNative(live: number): Promise<void> {
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
    registerIpc(() => mainWindow, resolveQuitChoice)
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
