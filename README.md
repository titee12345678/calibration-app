# Calibration App (Local SQLite Edition)

This project is a calibration logbook web application built with Node.js, Express, Socket.IO, and a vanilla JavaScript frontend. The backend now stores calibration records in a local SQLite database and saves uploaded images to the local filesystem, making it easy to run entirely on a Windows x64 Intel machine without any external services.

The server is configured to bind to `127.0.0.1` by default, so it only accepts traffic from the local computer. Adjust the `HOST` environment variable if you explicitly want to expose it to other devices on your network.

## Prerequisites

- Node.js 18 หรือใหม่กว่า (รองรับ 23.x)
- npm (bundled with Node.js)

## Getting started

1. Install dependencies (PowerShell on Windows works the same way):
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open your browser and navigate to [http://localhost:3000](http://localhost:3000).

### Share on local Wi‑Fi

- ให้คอมพิวเตอร์และอุปกรณ์เคลื่อนที่อยู่ในเครือข่ายเดียวกัน
- รันเซิร์ฟเวอร์ในโหมด LAN:
  ```bash
  npm run start:lan
  ```
- คอนโซลจะแสดง IP ภายใน เช่น `http://192.168.x.x:3000` ใช้ URL นี้เปิดจากมือถือ/แท็บเล็ตได้

## Desktop build with Electron

- Launch the desktop shell during development:
  ```bash
  npm run electron:start
  ```
  This boots the Express/Socket.IO backend and loads it inside an Electron window.
- Package a Windows x64 installer:
  ```bash
  npm run electron:build
  ```
  The build script automatically deletes any previous `dist/` directory before producing a fresh installer.

### เปิดใช้บนมือถือเมื่อรันด้วย Electron (Windows)

1. เปิดแอปครั้งแรกเพื่อให้ระบบสร้างโฟลเดอร์ข้อมูล (`%APPDATA%/Calibration App/`) พร้อมไฟล์ `config.json`.
2. จากเมนูด้านบนเลือก `Calibration App → เปิดโฟลเดอร์ข้อมูล` (หรือเปิดโฟลเดอร์ดังกล่าวเอง) แล้วแก้ไขไฟล์ `config.json` ให้ตั้งค่า `"host": "0.0.0.0"` และปรับพอร์ตตามต้องการ.
3. บันทึกไฟล์และรีสตาร์ทแอป หน้าแรกจะโชว์ URL ภายใน เช่น `http://192.168.x.x:3000` สำหรับเปิดจากมือถือ/แท็บเล็ตที่อยู่ใน Wi‑Fi เดียวกัน.
4. เมื่อ Windows แจ้งเตือน Firewall ให้กดยอมรับ เพื่อให้เครื่องอื่นในเครือข่ายเข้าถึงได้.

When packaged, the app stores its SQLite database and uploaded images inside the Electron user data folder (e.g. `%APPDATA%/Calibration App/`). You can still override `DATA_DIR` or `UPLOADS_DIR` to point elsewhere if needed.

## Data storage

- **Database**: A SQLite database file (`calibration.db`) is created automatically inside the `data/` directory on first launch.
- **Images**: Uploaded calibration images are stored in the `uploads/records/` directory. The server exposes them via the `/uploads` route so they can be displayed in the UI.

Both directories are created automatically if they do not exist. You can safely back up or migrate the entire application by copying the `data/` and `uploads/` folders.

## Environment variables (optional)

You can override these to fit your environment (e.g. storing data on another drive on Windows):

- `HOST`: Network interface to bind. Defaults to `127.0.0.1` (localhost only). Set to `0.0.0.0` to allow LAN access.
- `PORT`: Override the default server port (`3000`). Example: `PORT=4000 npm start`.
- `DATA_DIR`: Absolute or relative path where the SQLite database should live. Defaults to `<project>/data`.
- `UPLOADS_DIR`: Folder for calibration images. Defaults to `<project>/uploads`.
- `MAX_UPLOAD_SIZE_MB`: Maximum allowed image size in megabytes (defaults to `10`).

All directories are created automatically if they do not exist. The server validates that uploaded files are images and removes them again if the database insert fails, keeping the storage clean.
