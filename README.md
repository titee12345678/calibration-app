# Calibration App (Local SQLite Edition)

This project is a calibration logbook web application built with Node.js, Express, Socket.IO, and a vanilla JavaScript frontend. The backend now stores calibration records in a local SQLite database and saves uploaded images to the local filesystem, making it easy to run entirely on a Windows x64 Intel machine without any external services.

The server is configured to bind to `127.0.0.1` by default, so it only accepts traffic from the local computer. Adjust the `HOST` environment variable if you explicitly want to expose it to other devices on your network.

## Prerequisites

- Node.js 18 or newer
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

