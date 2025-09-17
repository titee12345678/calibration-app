const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const initSqlJs = require('sql.js');
require('dotenv').config();

const resolveDir = (dir, fallback) => (dir ? path.resolve(dir) : fallback);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

let serverInstance = null;

const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPLOAD_SIZE_MB = Number.parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 10;

const DATA_DIR = resolveDir(process.env.DATA_DIR, path.join(__dirname, 'data'));
const UPLOADS_DIR = resolveDir(process.env.UPLOADS_DIR, path.join(__dirname, 'uploads'));
const RECORDS_UPLOAD_DIR = path.join(UPLOADS_DIR, 'records');

// Ensure required directories exist for database and file uploads
[DATA_DIR, RECORDS_UPLOAD_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});


const dbPath = path.join(DATA_DIR, 'calibration.db');
let sqlModulePromise = null;
let SQL = null;
let db = null;
let persistQueue = Promise.resolve();

const resolveSqlJsDist = () => {
  const candidates = [
    path.join(__dirname, 'node_modules', 'sql.js', 'dist'),
    path.join(__dirname, '..', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist') : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'sql-wasm.wasm'))) {
      return candidate;
    }
  }

  return path.join(__dirname, 'node_modules', 'sql.js', 'dist');
};

const getSqlModule = () => {
  if (!sqlModulePromise) {
    const distDir = resolveSqlJsDist();
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(distDir, file)
    })
      .then((module) => {
        SQL = module;
        return SQL;
      })
      .catch((err) => {
        sqlModulePromise = null;
        throw err;
      });
  }
  return sqlModulePromise;
};

const persistDatabase = async () => {
  if (!db) return;
  const data = db.export();
  await fsPromises.writeFile(dbPath, Buffer.from(data));
};

const queuePersist = () => {
  persistQueue = persistQueue
    .then(() => persistDatabase())
    .catch((err) => {
      console.error('Failed to persist database:', err);
    });
  return persistQueue;
};

let dbPromise = null;

const loadDatabase = async () => {
  if (db) {
    return db;
  }

  if (!dbPromise) {
    dbPromise = (async () => {
      const SQLModule = await getSqlModule();
      const hasExistingFile = fs.existsSync(dbPath);
      if (hasExistingFile) {
        const fileBuffer = await fsPromises.readFile(dbPath);
        db = fileBuffer.length ? new SQLModule.Database(fileBuffer) : new SQLModule.Database();
      } else {
        db = new SQLModule.Database();
      }

      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA journal_mode = WAL');
      db.run(`
        CREATE TABLE IF NOT EXISTS records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          machine TEXT NOT NULL,
          volume REAL,
          date TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pass','fail')),
          image_path TEXT,
          timestamp TEXT NOT NULL,
          calibrator TEXT NOT NULL,
          notes TEXT
        );
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_records_machine ON records(machine)');
      db.run('CREATE INDEX IF NOT EXISTS idx_records_date ON records(date)');
      console.log(`Connected to SQLite database at ${dbPath}`);

      if (!hasExistingFile) {
        await queuePersist();
      }

      return db;
    })().catch((err) => {
      db = null;
      dbPromise = null;
      throw err;
    });
  }

  try {
    await dbPromise;
    return db;
  } catch (err) {
    dbPromise = null;
    throw err;
  }
};

const runAsync = async (sql, params = []) => {
  const database = await loadDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
  } finally {
    stmt.free();
  }

  const isInsert = /^\s*insert/i.test(sql);
  let lastID;
  if (isInsert) {
    const result = database.exec('SELECT last_insert_rowid() as id');
    if (result.length && result[0].values.length) {
      lastID = Number(result[0].values[0][0]);
    }
  }
  const changes = database.getRowsModified();
  await queuePersist();

  return { lastID, changes };
};

const allAsync = async (sql, params = []) => {
  const database = await loadDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
};

const getAsync = async (sql, params = []) => {
  const database = await loadDatabase();
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) {
      return stmt.getAsObject();
    }
    return undefined;
  } finally {
    stmt.free();
  }
};

const gatherLanUrls = (port) => {
  const urls = new Set();
  const nets = os.networkInterfaces();
  Object.values(nets).forEach((interfaces = []) => {
    interfaces
      .filter((iface) => !iface.internal && iface.family === 'IPv4' && iface.address)
      .forEach((iface) => {
        urls.add(`http://${iface.address}:${port}`);
      });
  });
  return Array.from(urls);
};

app.get('/api/server-info', (req, res) => {
  if (!server.listening) {
    return res.status(503).json({ error: 'server not ready' });
  }

  const address = server.address();
  const resolvedHost = address && address.address ? address.address : HOST;
  const resolvedPort = address && address.port ? address.port : PORT;
  const baseHost = resolvedHost === '::' ? 'localhost' : resolvedHost;
  const lanUrls = gatherLanUrls(resolvedPort);

  res.json({
    host: resolvedHost,
    port: resolvedPort,
    baseUrl: `http://${baseHost}:${resolvedPort}`,
    lanUrls,
    isBoundToAll: resolvedHost === '0.0.0.0' || resolvedHost === '::',
    configPath: process.env.APP_CONFIG_PATH || null
  });
});



app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve root index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Machine master data (managed on server)
const machines = {
  'DD50-1': 800, 'DD50-2': 800, 'DD100': 900, 'DD200-1': 1800, 'DD200-2': 1800, 'DD600': 3960,
  'DL2-1': 16, 'DL500-1': 5, 'DL500-2': 5, 'DL500-3': 5, 'DL500-4': 5,
  'DL250-1': 3.5, 'DL250-2': 3.5, 'DL250-3': 3.5, 'DL250-4': 3.5,
  'DL125-1': 2, 'DL125-2': 2, 'DL125-3': 2, 'DL125-4': 2,
  'RK3-1': 26, 'RK3-2': 26, 'RK3-3': 26, 'RK3-4': 26, 'RK3-5': 26, 'RK3-6': 26,
  'RK6-1': 44, 'RK6-2': 44, 'RK6-3': 44, 'RK6-4': 44, 'RK6-5': 44, 'RK6-6': 44,
  'LX4': 60, 'LX5': 60, 'LX6': 60, 'LX7': 60, 'LX8': 60, 'LX9': 60, 'LX10': 60, 'LX11': 60, 'LX12': 60, 'LX13': 60, 'LX14': 60, 'LX15': 60, 'LX16': 60, 'LX17': 60,
  'A5': 225, 'B6': 225, 'B7': 225, 'A4': 145, 'B1': 225, 'B5': 145
};

// GET: list all machines
app.get('/api/machines', (req, res) => {
  res.json(machines);
});

const { promises: fsPromises } = fs;

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/svg+xml'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, RECORDS_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (!allowedMimeTypes.has(mime)) {
      cb(new Error('รองรับเฉพาะไฟล์รูปภาพเท่านั้น'));
    } else {
      cb(null, true);
    }
  }
});

const uploadSingleImage = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `ขนาดไฟล์ต้องไม่เกิน ${MAX_UPLOAD_SIZE_MB}MB` });
      }
      return res.status(400).json({ error: err.message || 'ไม่สามารถอัปโหลดไฟล์ได้' });
    }
    return next();
  });
};

const toPublicUrl = (storedPath) => {
  if (!storedPath) return null;
  return `/uploads/${storedPath.split(path.sep).join('/')}`;
};

const buildStoredPath = (absolutePath) => {
  if (!absolutePath) return null;
  const relative = path.relative(UPLOADS_DIR, absolutePath);
  if (!relative || relative.startsWith('..')) {
    return null;
  }
  return relative.split(path.sep).join('/');
};

const deleteFileIfExists = async (storedPath) => {
  if (!storedPath) return;
  const absolute = path.join(UPLOADS_DIR, storedPath.split('/').join(path.sep));
  try {
    await fsPromises.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to remove file ${absolute}:`, err);
    }
  }
};

const mapRecord = (row) => ({
  _id: row.id,
  machine: row.machine,
  volume: row.volume,
  date: row.date,
  status: row.status,
  image: toPublicUrl(row.image_path),
  timestamp: row.timestamp,
  calibrator: row.calibrator,
  notes: row.notes || null
});

// GET: list all records ordered by date desc
app.get('/api/records', async (req, res) => {
  try {
    const rows = await allAsync('SELECT * FROM records ORDER BY datetime(date) DESC, id DESC');
    res.json(rows.map(mapRecord));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const allowedStatuses = new Set(['pass', 'fail']);

// POST: upload optional image + insert row
app.post('/api/records', uploadSingleImage, async (req, res) => {
  let storedPath = null;
  try {
    const { machine, date, status, calibrator, notes } = req.body;

    if (!machine || !Object.prototype.hasOwnProperty.call(machines, machine)) {
      return res.status(400).json({ error: 'กรุณาเลือกเครื่องย้อมจากรายการที่มีอยู่' });
    }

    if (!date || !status || !calibrator) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    const normalizedStatus = String(status).toLowerCase();
    if (!allowedStatuses.has(normalizedStatus)) {
      return res.status(400).json({ error: 'สถานะต้องเป็น pass หรือ fail เท่านั้น' });
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' });
    }

    const isoDate = parsedDate.toISOString();
    const timestamp = new Date().toISOString();
    const cleanedCalibrator = String(calibrator).trim();

    if (!cleanedCalibrator) {
      return res.status(400).json({ error: 'กรุณาระบุชื่อผู้สอบเทียบ' });
    }

    const cleanedNotes = typeof notes === 'string' && notes.trim().length ? notes.trim() : null;
    storedPath = req.file ? buildStoredPath(req.file.path) : null;

    if (req.file && !storedPath) {
      throw new Error('ไม่สามารถบันทึกไฟล์รูปภาพได้');
    }
    const volume = Number(machines[machine]);

    const result = await runAsync(
      `INSERT INTO records (machine, volume, date, status, image_path, timestamp, calibrator, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        machine,
        volume,
        isoDate,
        normalizedStatus,
        storedPath,
        timestamp,
        cleanedCalibrator,
        cleanedNotes
      ]
    );

    const inserted = await getAsync('SELECT * FROM records WHERE id = ?', [result.lastID]);
    const payload = mapRecord(inserted);

    io.emit('records-updated', { type: 'insert', record: payload });
    res.status(201).json(payload);
  } catch (e) {
    if (storedPath) {
      await deleteFileIfExists(storedPath);
    } else if (req.file) {
      try {
        await fsPromises.unlink(req.file.path);
      } catch (unlinkErr) {
        if (unlinkErr.code !== 'ENOENT') {
          console.error('ไม่สามารถลบไฟล์ชั่วคราวได้:', unlinkErr);
        }
      }
    }
    res.status(500).json({ error: e.message });
  }
});

// DELETE by id: remove row + storage file
app.delete('/api/records/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'รหัสรายการไม่ถูกต้อง' });
    }

    const row = await getAsync('SELECT image_path, machine FROM records WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ error: 'ไม่พบรายการที่ต้องการลบ' });
    }

    await runAsync('DELETE FROM records WHERE id = ?', [id]);
    await deleteFileIfExists(row.image_path);

    io.emit('records-updated', { type: 'delete', id, machine: row.machine });
    res.json({ message: 'ลบข้อมูลเรียบร้อย', id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE many by machine (bulk)
app.delete('/api/records', async (req, res) => {
  try {
    const { machine } = req.query;
    if (!machine) return res.status(400).json({ error: 'ต้องระบุเครื่องย้อม' });
    if (!Object.prototype.hasOwnProperty.call(machines, machine)) {
      return res.status(400).json({ error: 'เครื่องย้อมไม่ถูกต้อง' });
    }

    const rows = await allAsync('SELECT id, image_path FROM records WHERE machine = ?', [machine]);

    await runAsync('DELETE FROM records WHERE machine = ?', [machine]);

    await Promise.all(rows.map((r) => deleteFileIfExists(r.image_path)));

    io.emit('records-updated', { type: 'bulk-delete', machine });
    res.json({ message: `ลบข้อมูลของ ${machine} แล้ว ${rows.length} รายการ`, deleted: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


io.on('connection', () => {
  // optional handshake logs
});

let shuttingDown = false;

const shutdown = (shouldExit = false) => new Promise((resolve) => {
  if (shuttingDown) {
    if (!shouldExit) {
      return resolve();
    }
  }
  shuttingDown = true;
  console.log('\nกำลังปิดเซิร์ฟเวอร์...');

  const finalize = async () => {
    try {
      await persistQueue;
      await persistDatabase();
      if (db) {
        db.close();
        db = null;
        dbPromise = null;
        console.log('ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อย');
      }
    } catch (err) {
      console.error('ปิดฐานข้อมูลไม่สำเร็จ:', err);
    } finally {
      persistQueue = Promise.resolve();
      if (shouldExit) {
        process.exit(0);
      }
      resolve();
    }
  };

  if (server.listening) {
    server.close(() => {
      serverInstance = null;
      finalize();
    });
  } else {
    finalize();
  }
});

const gracefulShutdown = () => {
  shutdown(true);
};

const startServer = async (port = PORT, host = HOST) => {
  await loadDatabase();

  if (serverInstance && serverInstance.listening) {
    return serverInstance;
  }

  return new Promise((resolve, reject) => {
    const logAddresses = () => {
      const address = server.address();
      const resolvedHost = address && address.address ? address.address : host;
      const resolvedPort = address && address.port ? address.port : port;
      console.log(`Server running on http://${resolvedHost}:${resolvedPort}`);

      if (resolvedHost === '0.0.0.0' || resolvedHost === '::') {
        gatherLanUrls(resolvedPort).forEach((url) => {
          console.log(`  ➜ ${url}`);
        });
      }
    };

    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };

    const onListening = () => {
      server.removeListener('error', onError);
      serverInstance = server;
      logAddresses();
      shuttingDown = false;
      resolve(serverInstance);
    };

    server.once('error', onError);
    server.listen(port, host, onListening);
  });
};

const stopServer = () => shutdown(false);

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  io,
  startServer,
  stopServer
};
