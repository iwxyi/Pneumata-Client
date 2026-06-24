const CLIENT_URL = process.env.PNEUMATA_CLIENT_URL || 'http://127.0.0.1:5174';
const CDP_URL = process.env.PNEUMATA_CDP_URL || 'http://127.0.0.1:9222';
const ADMIN_EMAIL = process.env.ADMIN_SMOKE_EMAIL || process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_SMOKE_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin';

async function cdpFetch(path, init) {
  const response = await fetch(`${CDP_URL}${path}`, init);
  if (!response.ok) throw new Error(`CDP ${path} failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : null;
}

class CdpClient {
  constructor(webSocketDebuggerUrl) {
    this.ws = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      this.events.push(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  close() {
    this.ws.close();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}

async function navigate(cdp, path) {
  await cdp.send('Page.navigate', { url: `${CLIENT_URL}${path}` });
  await waitFor(cdp, `document.readyState === 'complete' || document.readyState === 'interactive'`, 10000);
}

async function waitFor(cdp, conditionExpression, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await evaluate(cdp, `Boolean(${conditionExpression})`).catch(() => false);
    if (ok) return;
    await wait(150);
  }
  const snapshot = await pageSnapshot(cdp).catch(() => null);
  throw new Error(`Timed out waiting for condition: ${conditionExpression}\n${JSON.stringify(snapshot, null, 2)}`);
}

async function pageSnapshot(cdp) {
  return JSON.parse(await evaluate(cdp, `JSON.stringify({
    path: location.pathname,
    title: document.title,
    bodyText: document.body.innerText.slice(0, 2000),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((item) => item.textContent),
    buttons: Array.from(document.querySelectorAll('button')).map((item) => item.textContent).slice(0, 20),
  })`));
}

function findRuntimeErrors(events) {
  return events
    .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
    .map((event) => event.params?.exceptionDetails?.text || event.params?.entry?.text || JSON.stringify(event.params))
    .filter((text) => {
      const value = String(text || '');
      return value && !value.includes('favicon') && !value.includes('ResizeObserver loop completed');
    });
}

async function assertAdminPage(cdp, route, expectedText) {
  await navigate(cdp, route);
  await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(expectedText)})`, 12000);
  const snapshot = await pageSnapshot(cdp);
  const forbidden = [
    '后台接口返回了前端页面',
    'Unexpected token',
    '当前管理员没有访问该模块的权限',
    '管理员未登录',
    '登录后台',
  ];
  const found = forbidden.find((text) => snapshot.bodyText.includes(text));
  if (found) {
    throw new Error(`Admin page ${route} displayed forbidden text: ${found}\n${JSON.stringify(snapshot, null, 2)}`);
  }
  return snapshot;
}

async function getPage() {
  const pages = await cdpFetch('/json/list');
  const page = pages.find((item) => item.type === 'page');
  if (page) return page;
  return cdpFetch(`/json/new?${encodeURIComponent(`${CLIENT_URL}/admin/login`)}`, { method: 'PUT' });
}

const page = await getPage();
const cdp = new CdpClient(page.webSocketDebuggerUrl);
await cdp.open();

try {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate(cdp, '/');
  await evaluate(cdp, `localStorage.removeItem('pneumata-admin-token'); 'cleared'`);
  await navigate(cdp, '/admin/login');
  await waitFor(cdp, `document.body.innerText.includes('后台登录')`);

  const loginResult = JSON.parse(await evaluate(cdp, `fetch('/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(ADMIN_EMAIL)}, password: ${JSON.stringify(ADMIN_PASSWORD)} })
  }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'admin login failed');
    localStorage.setItem('pneumata-admin-token', payload.token);
    return JSON.stringify({ email: payload.admin.email, permissions: payload.admin.permissions.length });
  })`, true));

  if (!loginResult.permissions) {
    throw new Error('Admin browser smoke login did not return permissions');
  }

  const routes = [
    ['/admin', '总览'],
    ['/admin/users', '用户'],
    ['/admin/ai', 'AI平台'],
    ['/admin/billing', '计费订单'],
    ['/admin/moderation', '分享审核'],
    ['/admin/notifications', '通知中心'],
    ['/admin/risk', '风控限制'],
    ['/admin/audit', '审计日志'],
  ];

  const snapshots = [];
  for (const [route, expectedText] of routes) {
    snapshots.push(await assertAdminPage(cdp, route, expectedText));
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  const mobileSnapshot = await assertAdminPage(cdp, '/admin/users', '用户');
  await waitFor(cdp, `document.body.innerText.includes('详情') || document.body.innerText.includes('暂无用户')`, 12000);
  const mobileUsersReady = await pageSnapshot(cdp);
  if (!mobileUsersReady.bodyText.includes('详情') && !mobileUsersReady.bodyText.includes('暂无用户')) {
    throw new Error(`Mobile users page did not expose user detail actions or an empty state\n${JSON.stringify(mobileUsersReady, null, 2)}`);
  }

  const errors = findRuntimeErrors(cdp.events);
  if (errors.length) {
    throw new Error(`Admin browser smoke captured runtime errors:\n${errors.join('\n')}`);
  }

  console.log(JSON.stringify({
    ok: true,
    clientUrl: CLIENT_URL,
    admin: loginResult.email,
    visited: snapshots.map((snapshot) => snapshot.path),
    mobile: mobileSnapshot.path,
  }, null, 2));
} finally {
  cdp.close();
}
