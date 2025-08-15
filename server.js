const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Supabase client (ใช้ service role key ฝั่งเซิร์ฟเวอร์เท่านั้น)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const BUCKET = process.env.SUPABASE_BUCKET || 'calibration';

// multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

// GET: อ่านรายการทั้งหมด เรียงวันที่ใหม่ก่อน
app.get('/api/records', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('records')
      .select('*')
      .order('date', { ascending: false });
    if (error) throw error;

    // map ให้สอดคล้องกับ UI เดิม (_id และ image)
    const mapped = (data || []).map(r => ({
      _id: r.id,
      machine: r.machine,
      volume: r.volume,
      date: r.date,
      status: r.status,
      image: r.image_url || null,
      timestamp: r.timestamp || new Date(r.created_at).toLocaleString('th-TH')
    }));
    res.json(mapped);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST: อัปโหลดรูปขึ้น Storage + บันทึกแถวใน DB
app.post('/api/records', upload.single('image'), async (req, res) => {
  try {
    const { machine, volume, date, status, timestamp } = req.body;

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

      // bucket public → ได้ URL ตรง
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(file_path);
      image_url = data.publicUrl;
      // ถ้าเป็น private ให้ใช้ createSignedUrl แทน
    }

    const { data: inserted, error: dbErr } = await supabase
      .from('records')
      .insert({
        machine,
        volume: Number(volume),
        date,          // 'YYYY-MM-DD'
        status,        // 'pass' | 'fail'
        image_url,
        file_path,
        timestamp: timestamp || new Date().toLocaleString('th-TH')
      })
      .select()
      .single();
    if (dbErr) throw dbErr;

    res.status(201).json({
      _id: inserted.id,
      machine: inserted.machine,
      volume: inserted.volume,
      date: inserted.date,
      status: inserted.status,
      image: inserted.image_url || null,
      timestamp: inserted.timestamp
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE: ลบเอกสาร + ไฟล์
app.delete('/api/records/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // หา path ไฟล์ก่อน
    const { data: rows, error: qErr } = await supabase
      .from('records')
      .select('file_path')
      .eq('id', id)
      .limit(1);
    if (qErr) throw qErr;

    const filePath = rows?.[0]?.file_path;

    // ลบ DB
    const { error: delErr } = await supabase
      .from('records')
      .delete()
      .eq('id', id);
    if (delErr) throw delErr;

    // ลบไฟล์ใน Storage ถ้ามี
    if (filePath) {
      await supabase.storage.from(BUCKET).remove([filePath]);
    }

    res.json({ message: 'Record deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
