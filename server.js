const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const RECORDS_UPLOAD_DIR = path.join(UPLOADS_DIR, 'records');

// Ensure required directories exist for database and file uploads
[DATA_DIR, RECORDS_UPLOAD_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const dbPath = path.join(DATA_DIR, 'calibration.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err);
  } else {
    console.log(`Connected to SQLite database at ${dbPath}`);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine TEXT NOT NULL,
      volume REAL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      image_path TEXT,
      timestamp TEXT NOT NULL,
      calibrator TEXT NOT NULL,
      notes TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_records_machine ON records(machine)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_records_date ON records(date)`);
});

const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) {
      reject(err);
    } else {
      resolve({ lastID: this.lastID, changes: this.changes });
    }
  });
});

const allAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) {
      reject(err);
    } else {
      resolve(rows);
    }
  });
});

const getAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) {
      reject(err);
    } else {
      resolve(row);
    }
  });
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, RECORDS_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${ext}`);
  }
});

const upload = multer({ storage });

const toPublicUrl = (storedPath) => {
  if (!storedPath) return null;
  const normalized = storedPath.replace(/\\/g, '/');
  return `/uploads/${normalized}`;
};

const deleteFileIfExists = async (storedPath) => {
  if (!storedPath) return;
  const absolute = path.join(UPLOADS_DIR, storedPath.replace(/\//g, path.sep));
  try {
    await fsPromises.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to remove file ${absolute}:`, err);
    }
  }
};

// GET: list all records ordered by date desc
app.get('/api/records', async (req, res) => {
  try {
    const rows = await allAsync('SELECT * FROM records ORDER BY date DESC');
    const mapped = rows.map((r) => ({
      _id: r.id,
      machine: r.machine,
      volume: r.volume,
      date: r.date,
      status: r.status,
      image: toPublicUrl(r.image_path),
      timestamp: r.timestamp,
      calibrator: r.calibrator,
      notes: r.notes || null
    }));
    res.json(mapped);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: upload optional image + insert row
app.post('/api/records', upload.single('image'), async (req, res) => {
  try {
    const { machine, date, status, calibrator, notes } = req.body;
    const volume = machines[machine] || null;

    if (!volume) {
      return res.status(400).json({ error: 'Invalid machine specified.' });
    }

    if (!date || !status || !calibrator) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format.' });
    }
    const isoDate = parsedDate.toISOString();

    const timestamp = new Date().toISOString();
    const cleanedNotes = notes && notes.trim().length ? notes.trim() : null;

    let storedPath = null;
    if (req.file) {
      const relative = path.relative(UPLOADS_DIR, req.file.path);
      storedPath = relative.split(path.sep).join('/');
    }

    const result = await runAsync(
      `INSERT INTO records (machine, volume, date, status, image_path, timestamp, calibrator, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        machine,
        Number(volume),
        isoDate,
        status,
        storedPath,
        timestamp,
        calibrator,
        cleanedNotes
      ]
    );

    const inserted = await getAsync('SELECT * FROM records WHERE id = ?', [result.lastID]);
    const payload = {
      _id: inserted.id,
      machine: inserted.machine,
      volume: inserted.volume,
      date: inserted.date,
      status: inserted.status,
      image: toPublicUrl(inserted.image_path),
      timestamp: inserted.timestamp,
      calibrator: inserted.calibrator,
      notes: inserted.notes
    };

    io.emit('records-updated', { type: 'insert', record: payload });
    res.status(201).json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE by id: remove row + storage file
app.delete('/api/records/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const row = await getAsync('SELECT image_path, machine FROM records WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Record not found' });
    }

    await runAsync('DELETE FROM records WHERE id = ?', [id]);
    await deleteFileIfExists(row.image_path);

    io.emit('records-updated', { type: 'delete', id, machine: row.machine });
    res.json({ message: 'Record deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE many by machine (bulk)
app.delete('/api/records', async (req, res) => {
  try {
    const { machine } = req.query;
    if (!machine) return res.status(400).json({ error: 'machine is required' });

    const rows = await allAsync('SELECT id, image_path FROM records WHERE machine = ?', [machine]);

    await runAsync('DELETE FROM records WHERE machine = ?', [machine]);

    await Promise.all(rows.map((r) => deleteFileIfExists(r.image_path)));

    io.emit('records-updated', { type: 'bulk-delete', machine });
    res.json({ message: `Deleted ${rows?.length || 0} records for ${machine}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


io.on('connection', (socket) => {
  // optional handshake logs
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});