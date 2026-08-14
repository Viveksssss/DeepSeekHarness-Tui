'use strict';

/**
 * DeepSeek Harness — desktop shell.
 *
 * Boots the bundled `dsh web` server in a child process using a bundled Node 22
 * runtime (no system Node required) and then opens a native window onto the
 * served GUI.
 *
 * The whole @deepseek-ai/dsh installation (and its dependency closure) is
 * bundled as regular files inside this app's node_modules, which is why the
 * app ships with `asar: false` — a child Node process cannot read from an asar
 * archive, and `dsh` creates symlinks into its own node_modules at boot.
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 90 * 1000;

// Align the Wayland app_id / X11 WM_CLASS with the installed .desktop filename
// (see package.json `desktopName` + `linux.syncDesktopName`) so desktop
// environments can associate running windows with the launcher entry.
app.setDesktopName('deepseek-harness.desktop');

let serverProc = null;
let mainWindow = null;
let quitting = false;

/** Absolute path of the bundled dsh CLI entry (lib/bin.js). */
function resolveDshBin() {
  const pkg = require.resolve('@deepseek-ai/dsh/package.json');
  const bin = path.join(path.dirname(pkg), 'lib', 'bin.js');
  if (!fs.existsSync(bin)) {
    throw new Error(`dsh entry not found: ${bin}`);
  }
  return bin;
}

/**
 * Absolute path of the bundled Node.js runtime.
 *
 * dsh is built and tested against Node 22 and relies on `node-addon-require-builtin`
 * plus native modules (sharp, node-pty, …) that are incompatible with Electron's
 * own embedded Node 24 runtime. We therefore ship a real Node 22 runtime and run
 * the server with it, exactly like the standalone `dsh` CLI does.
 */
function resolveNodeBinary() {
  const rel = path.join('node', 'bin', 'node');
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, rel)
    : path.join(__dirname, 'vendor', rel);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Bundled Node runtime not found: ${candidate}`);
  }
  return candidate;
}

/** Where the child process output is mirrored for diagnostics. */
function serverLogPath() {
  return path.join(app.getPath('userData'), 'dsh-web.log');
}

/** Spawn the dsh web server with an OS-assigned port, using the bundled Node runtime. */
function spawnDshWeb() {
  const bin = resolveDshBin();
  const nodeBin = resolveNodeBinary();
  const logPath = serverLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n=== boot ${new Date().toISOString()} ===\n`);

  serverProc = spawn(
    nodeBin,
    [bin, 'web', '--host', HOST, '--port', '0'],
    {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  serverProc.stdout.on('data', (chunk) => logStream.write(chunk));
  serverProc.stderr.on('data', (chunk) => logStream.write(chunk));
  serverProc.on('exit', (code, signal) => {
    logStream.write(`\n=== exit ${new Date().toISOString()} code=${code} signal=${signal} ===\n`);
    logStream.end();
    if (!quitting && code !== null && code !== 0) {
      // Server died on its own while we were not shutting down.
      showFatalError(
        'The Harness server stopped unexpectedly.',
        `Exit code ${code}.\n\nLog: ${logPath}`,
      );
    }
  });

  return serverProc;
}

/** Resolve the served URL from the child's stdout ("dsh web: http://127.0.0.1:<port>"). */
function waitForUrl(proc, timeoutMs = STARTUP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const re = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/;
    let tail = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for the Harness web server.\n\n--- output tail ---\n${tail}`));
    }, timeoutMs);

    const onData = (chunk) => {
      tail = (tail + chunk.toString()).slice(-8192);
      const m = tail.match(re);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(m[1]);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Harness server exited before it was ready (code=${code}, signal=${signal}).\n\n--- output tail ---\n${tail}`));
    });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function showFatalError(title, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      `window.__setLoadingError && window.__setLoadingError(${JSON.stringify(title)}, ${JSON.stringify(detail)})`,
    ).catch(() => {});
  }
  dialog.showErrorBox(title, detail);
}

/** Keep every navigation inside the native window; hand real external links to the OS browser. */
function wireNavigation(window) {
  const allowedOrigin = (url) => {
    try {
      const u = new URL(url);
      return u.hostname === HOST || u.hostname === 'localhost';
    } catch {
      return false;
    }
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedOrigin(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('devtools:')) return;
    if (!allowedOrigin(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    backgroundColor: '#0d1117',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  wireNavigation(mainWindow);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/** Poll a URL until it returns HTTP 200 (handles the loader → server handoff). */
function waitHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 400) return resolve();
        retry(new Error(`HTTP ${res.statusCode}`));
      });
      req.on('error', retry);
      req.setTimeout(1500, () => req.destroy());
    };
    const retry = (err) => {
      if (Date.now() > deadline) return reject(err || new Error('HTTP poll timed out'));
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

async function boot() {
  const window = createWindow();
  const loading = path.join(__dirname, 'assets', 'loading.html');
  await window.loadFile(loading);

  const proc = spawnDshWeb();
  let url;
  try {
    url = await waitForUrl(proc);
    await waitHttp(url);
  } catch (err) {
    showFatalError('DeepSeek Harness failed to start', String(err && err.message ? err.message : err));
    return;
  }

  if (quitting) return;
  try {
    await window.loadURL(url);
  } catch (err) {
    showFatalError('DeepSeek Harness failed to load', String(err && err.message ? err.message : err));
  }
}

async function shutdown() {
  if (quitting) return;
  quitting = true;

  const proc = serverProc;
  serverProc = null;
  if (proc && proc.exitCode === null) {
    proc.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }, 5000);
    killTimer.unref();
  }
}

// Single instance: focus the existing window instead of booting a second server.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    boot().catch((err) => {
      showFatalError('DeepSeek Harness failed to start', String(err && err.stack ? err.stack : err));
    });
  });

  app.on('before-quit', (event) => {
    // Let the async shutdown begin; app.quit() will proceed after our synchronous teardown here.
    shutdown();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !quitting) {
      boot().catch((err) => {
        showFatalError('DeepSeek Harness failed to start', String(err && err.stack ? err.stack : err));
      });
    }
  });

  process.on('SIGINT', () => app.quit());
  process.on('SIGTERM', () => app.quit());
}
