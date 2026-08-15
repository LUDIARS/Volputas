const path = require('node:path');
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  shell,
  utilityProcess,
} = require('electron');
const squirrelStartup = require('electron-squirrel-startup');
const { startAutoUpdates } = require('./autoUpdate');
const { DesktopServerController } = require('./serverController');

let mainWindow = null;
let serverController = null;
let stopUpdates = () => {};

function setupScriptsDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'setup-samples')
    : path.join(__dirname, 'setup-samples');
}

function registerDesktopHandlers() {
  ipcMain.handle('desktop:choose-data-repository', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'VolputasDataリポジトリを選択',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('desktop:open-setup-scripts', () =>
    shell.openPath(setupScriptsDirectory()));
}

async function createMainWindow() {
  serverController = new DesktopServerController({
    forkProcess: utilityProcess.fork.bind(utilityProcess),
  });
  const appUrl = await serverController.start();
  const allowedOrigin = new URL(appUrl).origin;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Volputas',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (new URL(targetUrl).origin !== allowedOrigin) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(appUrl);
}

async function bootstrap() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  await app.whenReady();
  // getDisplayMedia (game-screen recording on the emotion capture page) needs
  // an explicit handler in Electron. Prefer the OS picker; where it is not
  // available, offer the primary screen with loopback (system) audio so the
  // recording carries the game sound (spec/feature/emotion-capture-companion.md
  // §デスクトップキャプチャ).
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length === 0) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch(() => callback({}));
  }, { useSystemPicker: true });
  app.setAppUserModelId('com.squirrel.Volputas.Volputas');
  registerDesktopHandlers();
  stopUpdates = startAutoUpdates({ isPackaged: app.isPackaged });
  await createMainWindow();
}

function shutdownOwnedResources() {
  stopUpdates();
  serverController?.stop();
}

if (squirrelStartup) {
  app.quit();
} else {
  bootstrap().catch((error) => {
    process.stderr.write(`Volputas desktop failed: ${error.stack || error.message}\n`);
    dialog.showErrorBox('Volputasを起動できません', error.message);
    shutdownOwnedResources();
    app.quit();
  });
  app.once('before-quit', shutdownOwnedResources);
  app.on('window-all-closed', () => app.quit());
}
