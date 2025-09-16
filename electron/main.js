const path = require('path');
const { app, BrowserWindow, shell } = require('electron');

let mainWindow;
let stopServer;
let isQuitting = false;

const createWindow = async () => {
  const userDataRoot = path.join(app.getPath('userData'), 'calibration-app');
  process.env.DATA_DIR = process.env.DATA_DIR || path.join(userDataRoot, 'data');
  process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(userDataRoot, 'uploads');
  process.env.HOST = process.env.HOST || '127.0.0.1';
  process.env.PORT = process.env.PORT || '3000';

  const serverModule = require('../server');
  await serverModule.startServer(Number.parseInt(process.env.PORT, 10), process.env.HOST);
  stopServer = serverModule.stopServer;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true
    }
  });

  const startUrl = process.env.ELECTRON_START_URL || `http://${process.env.HOST}:${process.env.PORT}`;
  await mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
};

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (err) {
    console.error('Failed to start application:', err);
    app.exit(1);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((err) => {
        console.error('Failed to recreate window:', err);
      });
    }
  });
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  if (typeof stopServer === 'function') {
    event.preventDefault();
    isQuitting = true;
    Promise.resolve(stopServer())
      .catch((err) => {
        console.error('Failed to stop server cleanly:', err);
      })
      .finally(() => {
        app.exit(0);
      });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
