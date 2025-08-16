const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve root index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const BUCKET = process.env.SUPABASE_BUCKET || 'calibration';

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

// multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

// GET: list all records ordered by date desc
app.get('/api/records', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('records')
      .select('*')
      .order('date', { ascending: false });
    if (error) throw error;

    const mapped = (data || []).map(r => ({
      _id: r.id,
      machine: r.machine,
      volume: r.volume,
      date: r.date,
      status: r.status,
      image: r.image_url || null,
      timestamp: r.timestamp || new Date(r.created_at).toLocaleString('th-TH'),
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
    const volume = machines[machine] || null; // Get volume from server-side machine list

    if (!volume) {
        return res.status(400).json({ error: 'Invalid machine specified.' });
    }

    let image_url = null;
    let file_path = null;

    if (req.file) {
      const ext = path.extname(req.file.originalname) || '';
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
      file_path = `records/${fileName}`;

      const { error: upErr } = await supabase
        .storage
        .from(BUCKET)
        .upload(file_path, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(file_path);
      image_url = data.publicUrl;
    }

    const { data: inserted, error: dbErr } = await supabase
      .from('records')
      .insert({
        machine,
        volume: Number(volume),
        date,
        status,
        image_url,
        file_path,
        calibrator,
        notes,
        timestamp: new Date().toLocaleString('th-TH')
      })
      .select()
      .single();
    if (dbErr) throw dbErr;

    const payload = {
      _id: inserted.id,
      machine: inserted.machine,
      volume: inserted.volume,
      date: inserted.date,
      status: inserted.status,
      image: inserted.image_url || null,
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

    const { data: rows, error: qErr } = await supabase
      .from('records')
      .select('file_path, machine')
      .eq('id', id)
      .limit(1);
    if (qErr) throw qErr;
    const filePath = rows?.[0]?.file_path;
    const machine = rows?.[0]?.machine;

    const { error: delErr } = await supabase
      .from('records')
      .delete()
      .eq('id', id);
    if (delErr) throw delErr;

    if (filePath) {
      await supabase.storage.from(BUCKET).remove([filePath]);
    }

    io.emit('records-updated', { type: 'delete', id, machine });
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

    const { data: rows, error: qErr } = await supabase
      .from('records')
      .select('id, file_path')
      .eq('machine', machine);
    if (qErr) throw qErr;

    const { error: delErr } = await supabase
      .from('records')
      .delete()
      .eq('machine', machine);
    if (delErr) throw delErr;

    const paths = (rows || []).map(r => r.file_path).filter(Boolean);
    if (paths.length) {
      await supabase.storage.from(BUCKET).remove(paths);
    }

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