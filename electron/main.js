const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'M3U Player',
    width: 1280,
    height: 800,
    backgroundColor: '#0b0c10',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Desktop-only app: relax web security so streams/M3U/EPG don't get blocked by CORS.
      // This avoids requiring a separate background server.
      webSecurity: false
    }
  });

  await mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // Prevent new-window navigation from breaking the app; open external links in browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  // macOS behavior not needed on Pop!_OS but harmless
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On Linux/Windows, quit when all windows closed
  app.quit();
});

ipcMain.handle('m3uPlayer.fetchText', async (_event, url, options = {}) => {
  const method = options.method || 'GET';
  const headers = options.headers || {};

  const res = await fetch(url, { method, headers });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text
  };
});

ipcMain.handle('m3uPlayer.fetchStatus', async (_event, url, options = {}) => {
  const method = options.method || 'GET';
  const headers = options.headers || {};

  const res = await fetch(url, { method, headers });
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText
  };
});

ipcMain.handle('m3uPlayer.openExternal', async (_event, url) => {
  await shell.openExternal(url);
  return true;
});
