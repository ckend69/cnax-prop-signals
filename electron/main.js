const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#07071a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, '../src/assets/icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  Menu.setApplicationMenu(null);
}

// ── Decompress response stream based on Content-Encoding header ─────────────
function decompressStream(res) {
  const enc = (res.headers['content-encoding'] || '').toLowerCase();
  if (enc === 'gzip')    return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br')      return res.pipe(zlib.createBrotliDecompress());
  return res; // identity / no compression
}

// ── IPC: Fetch market data from main process (avoids CORS) ─────────────────
ipcMain.handle('fetch-url', async (event, url) => {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Origin': 'https://finance.yahoo.com',
      'Referer': 'https://finance.yahoo.com/',
    };

    function doRequest(reqUrl, depth) {
      if (depth > 3) return reject(new Error('Too many redirects'));
      const lib = reqUrl.startsWith('https') ? https : http;
      const req = lib.get(reqUrl, { headers }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain the response
          return doRequest(res.headers.location, depth + 1);
        }
        // Decompress and collect response body
        const stream = decompressStream(res);
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          try { resolve(JSON.parse(body)); }
          catch { resolve(body); }
        });
        stream.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    }

    doRequest(url, 0);
  });
});

// ── IPC: GET with custom headers (for APIs requiring header-based auth) ────
ipcMain.handle('fetch-get', async (event, { url, headers: extraHeaders = {} }) => {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      ...extraHeaders,
    };

    function doRequest(reqUrl, depth) {
      if (depth > 3) return reject(new Error('Too many redirects'));
      let urlObj;
      try { urlObj = new URL(reqUrl); } catch(e) { return reject(e); }
      const lib = reqUrl.startsWith('https') ? https : http;
      const options = {
        hostname: urlObj.hostname,
        port:     urlObj.port || (reqUrl.startsWith('https') ? 443 : 80),
        path:     urlObj.pathname + urlObj.search,
        method:   'GET',
        headers,
      };
      const req = lib.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return doRequest(res.headers.location, depth + 1);
        }
        const stream = decompressStream(res);
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          try { resolve(JSON.parse(body)); }
          catch { resolve(body); }
        });
        stream.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    }

    doRequest(url, 0);
  });
});

// ── IPC: POST requests (for Groq API) ──────────────────────────────────────
ipcMain.handle('fetch-post', async (event, { url, body, headers }) => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      const stream = decompressStream(res);
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Groq timeout')); });
    req.write(payload);
    req.end();
  });
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
