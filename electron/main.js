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
    host: '0.0.0.0',
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
  if (typeof host !== 'string') return '0.0.0.0';
  const trimmed = host.trim();
  if (!trimmed) return '0.0.0.0';
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

  // แก้ไข path สำหรับ production build
  const isDev = !app.isPackaged;
  let serverModule;

  try {
    if (isDev) {
      // Development mode
      serverModule = require(path.join(__dirname, '..', 'server.js'));
    } else {
      // Production mode - ลองหา server.js ในหลายที่
      const possiblePaths = [
        path.normalize(path.join(process.resourcesPath, 'app', 'server.js')),
        path.normalize(path.join(process.resourcesPath, 'app.asar', 'server.js')),
        path.normalize(path.join(__dirname, '..', 'server.js')),
        path.normalize(path.join(process.cwd(), 'resources', 'app', 'server.js')),
        path.normalize(path.join(process.cwd(), 'server.js')),
        // Windows specific paths
        process.platform === 'win32' && process.resourcesPath ?
          path.normalize(path.join(path.dirname(process.resourcesPath), 'app', 'server.js')) : null
      ].filter(Boolean);

      console.log('Searching for server.js in paths:', possiblePaths);

      let serverPath = null;
      for (const testPath of possiblePaths) {
        console.log(`Checking: ${testPath}`);
        if (fs.existsSync(testPath)) {
          serverPath = testPath;
          console.log(`Found server.js at: ${serverPath}`);
          break;
        }
      }

      if (!serverPath) {
        const errorMsg = `Cannot find server.js in production build. Searched paths: ${possiblePaths.join(', ')}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      serverModule = require(serverPath);
    }
  } catch (err) {
    console.error('Failed to load server module:', err);
    throw err;
  }
  console.log(`Starting server on ${process.env.HOST}:${process.env.PORT}`);
  await serverModule.startServer(Number.parseInt(process.env.PORT, 10), process.env.HOST);
  stopServer = serverModule.stopServer;

  // รอให้ server พร้อมก่อน load URL
  console.log('Server started, waiting for it to be ready...');
  await new Promise(resolve => setTimeout(resolve, 1000));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true
    }
  });

  // แก้ไข URL สำหรับ BrowserWindow - ไม่ใช้ 0.0.0.0
  const browserHost = process.env.HOST === '0.0.0.0' ? '127.0.0.1' : process.env.HOST;
  const startUrl = process.env.ELECTRON_START_URL || `http://${browserHost}:${process.env.PORT}`;

  console.log(`Loading URL in BrowserWindow: ${startUrl}`);

  // เพิ่ม retry mechanism
  let retries = 5;
  let lastError = null;

  while (retries > 0) {
    try {
      await mainWindow.loadURL(startUrl);
      console.log('Successfully loaded application');
      break;
    } catch (err) {
      lastError = err;
      retries--;
      console.log(`Failed to load URL (${6-retries}/5): ${err.message}`);

      if (retries > 0) {
        console.log(`Retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  if (retries === 0 && lastError) {
    throw new Error(`Failed to load application after 5 attempts: ${lastError.message}`);
  }

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
    // เพิ่ม environment detection
    console.log('App starting...', {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
      __dirname: __dirname
    });

    await createWindow();
  } catch (err) {
    console.error('Failed to start application:', err);

    // แสดง error dialog สำหรับ user
    const { dialog } = require('electron');
    dialog.showErrorBox('Application Error', `Failed to start application: ${err.message}`);

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
