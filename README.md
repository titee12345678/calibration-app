# Calibration App (Local SQLite Edition)

This project is a calibration logbook web application built with Node.js, Express, Socket.IO, and a vanilla JavaScript frontend. The backend now stores calibration records in a local SQLite database and saves uploaded images to the local filesystem, making it easy to run entirely on a Windows x64 Intel machine without any external services.

## Prerequisites

- Node.js 18 or newer
- npm (bundled with Node.js)

## Getting started

1. Install dependencies:
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

- `PORT`: Override the default server port (3000). Example: `PORT=4000 npm start`.

