const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBucket = process.env.SUPABASE_BUCKET;

// Create Supabase client with service role key (server side)
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Multer configuration for in-memory uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'), false);
    }
  }
});

/**
 * Helper to transform Supabase record into response format expected by the client.
 * Adds _id alias of id and renames image_url to image.
 */
function transformRecord(row) {
  return {
    _id: row.id,
    machine: row.machine,
    volume: row.volume,
    date: row.date,
    status: row.status,
    timestamp: row.timestamp,
    image: row.image_url || null
  };
}

// GET all records
app.get('/api/records', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('records')
      .select('*')
      .order('date', { ascending: false });
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    // Transform each record
    const transformed = data.map(transformRecord);
    res.json(transformed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST a new record with optional image upload
app.post('/api/records', upload.single('image'), async (req, res) => {
  try {
    const { machine, volume, date, status, timestamp } = req.body;
    let image_url = null;
    let file_path = null;

    // Upload image to Supabase Storage if provided
    if (req.file) {
      const ext = path.extname(req.file.originalname) || '';
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2)}${ext}`;
      file_path = `records/${uniqueName}`;
      // Upload to bucket
      const { error: uploadError } = await supabase.storage
        .from(supabaseBucket)
        .upload(file_path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (uploadError) {
        return res.status(500).json({ error: uploadError.message });
      }
      // Get public URL (assumes bucket is public) otherwise use createSignedUrl
      const { data: publicData } = supabase.storage
        .from(supabaseBucket)
        .getPublicUrl(file_path);
      image_url = publicData.publicUrl;
    }
    // Insert record into Supabase database
    const { data: inserted, error: insertError } = await supabase
      .from('records')
      .insert({
        machine,
        volume: parseFloat(volume),
        date,
        status,
        timestamp,
        image_url,
        file_path
      })
      .select()
      .single();
    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }
    // Transform and respond
    const transformed = transformRecord(inserted);
    res.status(201).json(transformed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a record by id (and remove associated image)
app.delete('/api/records/:id', async (req, res) => {
  try {
    const recordId = req.params.id;
    // Fetch record to get file_path
    const { data: row, error: fetchError } = await supabase
      .from('records')
      .select('file_path')
      .eq('id', recordId)
      .single();
    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116: Record not found
      return res.status(500).json({ error: fetchError.message });
    }
    // Delete record from database
    const { error: deleteError } = await supabase
      .from('records')
      .delete()
      .eq('id', recordId);
    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }
    // Remove file from storage if exists
    if (row && row.file_path) {
      await supabase.storage.from(supabaseBucket).remove([row.file_path]);
    }
    res.json({ message: 'Record deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} at ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);
});
