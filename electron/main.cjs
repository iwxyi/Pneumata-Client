const { app, BrowserWindow, protocol, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const APP_PROTOCOL = 'app';
const APP_HOST = 'sense-murmur';
const DEV_SERVER_ARG = '--dev-server=';
const ALLOWED_COMMANDS = new Set(['python', 'python3', 'node', 'npm', 'git', 'officecli']);
const MAX_NETWORK_RESOURCE_BYTES = 20 * 1024 * 1024;
const MAX_NETWORK_REDIRECTS = 4;

function isPrivateNetworkAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const value = String(address).toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value)
    || value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.')
    || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(value) || value.startsWith('::ffff:169.254.');
}

async function validateNetworkUrl(raw) {
  const url = new URL(String(raw || ''));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('network_url_invalid');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateNetworkAddress(item.address))) throw new Error('network_target_blocked');
  return url;
}

async function fetchNetworkResource(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(Number(request?.timeoutMs) || 20000, 60000)));
  try {
    const requestedUrl = await validateNetworkUrl(request?.url);
    let currentUrl = requestedUrl;
    let response = null;
    for (let redirect = 0; redirect <= MAX_NETWORK_REDIRECTS; redirect += 1) {
      response = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': 'SenseMurmur-Desktop/1.0' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location || redirect === MAX_NETWORK_REDIRECTS) throw new Error('network_redirect_limit');
      currentUrl = await validateNetworkUrl(new URL(location, currentUrl).toString());
    }
    if (!response) throw new Error('network_empty_response');
    if (!response.ok) throw new Error(`network_upstream_${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_NETWORK_RESOURCE_BYTES) throw new Error('network_resource_too_large');
    const chunks = [];
    let size = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_NETWORK_RESOURCE_BYTES) throw new Error('network_resource_too_large');
        chunks.push(Buffer.from(chunk));
      }
    }
    const buffer = Buffer.concat(chunks, size);
    const contentType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const binary = request?.mode === 'download' || !(contentType.startsWith('text/') || ['application/json', 'application/xml', 'application/xhtml+xml', 'image/svg+xml'].includes(contentType));
    const fileName = currentUrl.pathname.split('/').filter(Boolean).at(-1) || 'download';
    return { requestedUrl: requestedUrl.toString(), finalUrl: currentUrl.toString(), status: response.status, contentType, sizeBytes: buffer.length, fileName, encoding: binary ? 'base64' : 'utf8', content: binary ? buffer.toString('base64') : buffer.toString('utf8') };
  } finally {
    clearTimeout(timer);
  }
}

function validateCommandRequest(request) {
  const command = typeof request?.command === 'string' ? request.command.trim() : '';
  const args = Array.isArray(request?.args) ? request.args.filter((arg) => typeof arg === 'string').slice(0, 64) : [];
  if (!ALLOWED_COMMANDS.has(command)) throw new Error('command_not_allowed');
  if (args.some((arg) => /[;&|`$<>\n\r]/.test(arg))) throw new Error('unsafe_command_argument');
  const cwd = typeof request?.cwd === 'string' ? path.resolve(request.cwd) : process.cwd();
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('invalid_working_directory');
  return { command, args, cwd, timeoutMs: Math.max(1000, Math.min(Number(request?.timeoutMs) || 30000, 120000)) };
}

function runAllowedCommand(request) {
  const validated = validateCommandRequest(request);
  return new Promise((resolve, reject) => {
    const child = spawn(validated.command, validated.args, { cwd: validated.cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('command_timeout')); }, validated.timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk).slice(0, 200000); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 200000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: typeof code === 'number' ? code : -1, stdout, stderr }); });
  });
}

function registerIpcHandlers() {
  ipcMain.handle('pneumata:run-command', (_event, request) => runAllowedCommand(request));
  ipcMain.handle('pneumata:transform-office', async (_event, request) => {
    if (!request || typeof request.inputPath !== 'string' || typeof request.outputPath !== 'string') throw new Error('invalid_office_request');
    const result = await runAllowedCommand({ command: 'officecli', args: [String(request.operation || 'inspect'), request.inputPath, request.outputPath], cwd: path.dirname(path.resolve(request.inputPath)), timeoutMs: 120000 }).catch((error) => {
      throw new Error(`office_transform_failed:${error instanceof Error ? error.message : String(error)}`);
    });
    if (result.code !== 0) throw new Error(result.stderr || 'office_transform_failed');
    return { outputPath: request.outputPath };
  });
  ipcMain.handle('pneumata:system-action', async (_event, request) => {
    const action = request?.action;
    const rawTarget = typeof request?.target === 'string' ? request.target.trim() : '';
    if (!['open_path', 'reveal_path'].includes(action) || !rawTarget || rawTarget.includes('\0') || rawTarget.split(/[\\/]+/).includes('..')) throw new Error('invalid_system_action');
    const target = path.resolve(rawTarget);
    if (!fs.existsSync(target)) throw new Error('system_action_target_missing');
    if (action === 'reveal_path') {
      shell.showItemInFolder(target);
      return { ok: true };
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { ok: true };
  });
  ipcMain.handle('pneumata:fetch-network-resource', (_event, request) => fetchNetworkResource(request));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function resolveDistPath(requestUrl) {
  const distRoot = path.resolve(__dirname, '..', 'dist');
  const url = new URL(requestUrl);
  const requestedPath = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';
  const target = path.resolve(distRoot, requestedPath);
  if (!target.startsWith(distRoot)) return path.join(distRoot, 'index.html');
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  return path.join(distRoot, 'index.html');
}

async function registerAppProtocol() {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const filePath = resolveDistPath(request.url);
    const body = await fs.promises.readFile(filePath);
    return new Response(body, {
      headers: { 'content-type': contentTypeFor(filePath) },
    });
  });
}

function getDevServerUrl() {
  const arg = process.argv.find((value) => value.startsWith(DEV_SERVER_ARG));
  return arg ? arg.slice(DEV_SERVER_ARG.length) : '';
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: '生息 Sense Murmur',
    backgroundColor: '#f8f6fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const devServerUrl = getDevServerUrl();
  if (devServerUrl) {
    await win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  await win.loadURL(`${APP_PROTOCOL}://${APP_HOST}/index.html`);
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await registerAppProtocol();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
