import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { registerIpc } from './ipc'
import { detachAll, initServers, liveRunCount, stopAll } from './servers'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
/** Set once the user has chosen to quit, so the close handler stops intercepting. */
let quitting = false
/** Remembered only for this session; a relaunch asks again. */
let alwaysMinimise = false

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
    if (alwaysMinimise) {
      hideToTray()
      return
    }
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

  const plural = live === 1 ? 'server is' : 'servers are'
  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Close NPM Server Manager',
    message: `${live} dev ${plural} still running.`,
    detail:
      'Keep the app in the notification area to leave them running and stay in ' +
      'control of them, or quit and decide what happens to the servers.',
    buttons: ['Minimise to tray', 'Quit and stop servers', 'Quit, leave servers running', 'Cancel'],
    defaultId: 0,
    cancelId: 3,
    checkboxLabel: 'Also minimise to tray next time',
    checkboxChecked: false,
    noLink: true
  })

  if (response === 3) return

  if (response === 0) {
    if (checkboxChecked) alwaysMinimise = true
    hideToTray()
    return
  }

  quitting = true
  if (response === 1) await stopAll()
  app.quit()
}

function hideToTray(): void {
  mainWindow?.hide()
  tray?.displayBalloon?.({
    title: 'Still running',
    content: 'NPM Server Manager is in the notification area. Your dev servers keep running.',
    iconType: 'info'
  })
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

function createTray(): void {
  const image = nativeImage.createFromPath(assetPath('tray.png'))
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('NPM Server Manager')

  const rebuild = (): void => {
    const live = liveRunCount()
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: live === 0 ? 'No servers running' : `${live} server${live === 1 ? '' : 's'} running`,
          enabled: false
        },
        { type: 'separator' },
        { label: 'Open NPM Server Manager', click: showWindow },
        { type: 'separator' },
        {
          label: 'Quit, leave servers running',
          click: () => {
            quitting = true
            app.quit()
          }
        },
        {
          label: 'Quit and stop servers',
          click: async () => {
            quitting = true
            await stopAll()
            app.quit()
          }
        }
      ])
    )
  }

  rebuild()
  // Cheap enough to keep the running count honest without any event plumbing.
  setInterval(rebuild, 4000)

  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
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
    createTray()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Only reached when the window actually closed; minimising to tray prevents
    // the close, so this does not fire in that case.
    app.quit()
  })

  // Servers this app started keep running unless the user asked otherwise; all
  // that is needed here is to stop tailing and write out the run index.
  app.on('before-quit', () => {
    quitting = true
    detachAll()
  })

  app.on('will-quit', () => {
    tray?.destroy()
    tray = null
  })
}
