const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, Menu } = require('electron');

let mainWindow;
let stopServer;
let isQuitting = false;

const writeConfig = (configPath, payload) => {
  fs.writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const ensureConfig = (configPath) => {
  const defaults = {
    host: '127.0.0.1',
    port: 3000
  };

  try {
    if (!fs.existsSync(configPath)) {
      writeConfig(configPath, defaults);
      return defaults;
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed
    };
  } catch (err) {
    console.error('Failed to load config.json, reverting to defaults:', err);
    try {
      writeConfig(configPath, defaults);
    } catch (writeErr) {
      console.error('Unable to reset config.json:', writeErr);
    }
    return defaults;
  }
};

const sanitizeHost = (host) => {
  if (typeof host !== 'string') return '127.0.0.1';
  const trimmed = host.trim();
  if (!trimmed) return '127.0.0.1';
  return trimmed;
};

const sanitizePort = (port) => {
  const num = Number(port);
  if (!Number.isInteger(num) || num <= 0 || num > 65535) {
    return 3000;
  }
  return num;
};

const createWindow = async () => {
  const userDataRoot = path.join(app.getPath('userData'), 'calibration-app');
  if (!fs.existsSync(userDataRoot)) {
    fs.mkdirSync(userDataRoot, { recursive: true });
  }

  const configPath = path.join(userDataRoot, 'config.json');
  const config = ensureConfig(configPath);

  process.env.DATA_DIR = process.env.DATA_DIR || path.join(userDataRoot, 'data');
  process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(userDataRoot, 'uploads');
  const hostFromConfig = sanitizeHost(config.host);
  const portFromConfig = sanitizePort(config.port);
  process.env.HOST = process.env.HOST || hostFromConfig;
  process.env.PORT = process.env.PORT || String(portFromConfig);
  process.env.APP_CONFIG_PATH = configPath;

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

  const menuTemplate = [
    {
      label: 'Calibration App',
      submenu: [
        {
          label: 'เปิดโฟลเดอร์ข้อมูล',
          click: () => {
            const target = path.join(app.getPath('userData'), 'calibration-app');
            shell.openPath(target);
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'ออกจากโปรแกรม' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

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
