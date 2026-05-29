import { Hono } from 'hono'
import type { Env } from '../index'

const ADMIN_KEY_HEADER = 'X-Admin-Key'

function validateAdminKey(env: Env, header: string | undefined): boolean {
  if (!header) return false
  return header === env.DO_SHARED_SECRET
}

const app = new Hono<{ Bindings: Env }>()

// Admin UI
app.get('/', async (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Flaxia Crowd - API Key Management</title>
<style>
  :root { --bg: #0f0f1a; --surface: #1a1a2e; --border: #2a2a4e; --text: #e0e0f0; --muted: #8888aa; --accent: #7c3aed; --danger: #ef4444; --success: #22c55e; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 24px; }
  .container { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 24px; color: #fff; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
  .card h2 { font-size: 1.1rem; margin-bottom: 16px; color: #fff; }
  .form-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 0.85rem; color: var(--muted); }
  input, select, button { font-size: 0.9rem; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); outline: none; }
  input:focus, select:focus { border-color: var(--accent); }
  button { cursor: pointer; font-weight: 600; transition: all 0.15s; }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover { filter: brightness(1.15); }
  .btn-danger { background: transparent; border-color: var(--danger); color: var(--danger); }
  .btn-danger:hover { background: var(--danger); color: #fff; }
  .btn-sm { padding: 4px 10px; font-size: 0.8rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
  th { color: var(--muted); font-weight: 500; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .badge.active { background: rgba(34,197,94,0.15); color: var(--success); }
  .badge.revoked { background: rgba(239,68,68,0.15); color: var(--danger); }
  .key-display { font-family: "SF Mono","Fira Code",monospace; background: var(--bg); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border); word-break: break-all; margin: 12px 0; font-size: 0.85rem; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: #fff; color: #000; padding: 12px 20px; border-radius: 8px; font-weight: 500; z-index: 100; animation: fadeIn 0.2s; }
  .toast.error { background: var(--danger); color: #fff; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .empty { color: var(--muted); text-align: center; padding: 32px; }
  .key-prefix { font-family: monospace; color: var(--muted); font-size: 0.8rem; }
  .admin-key-input { width: 100%; margin-bottom: 16px; }
  .hidden { display: none; }
  th:last-child, td:last-child { text-align: right; }
  .scopes { display: flex; flex-wrap: wrap; gap: 4px; }
  .scope-tag { background: rgba(124,58,237,0.12); color: var(--accent); padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; }
</style>
</head>
<body>
<div class="container">
  <h1>🔑 Flaxia Crowd API Key Management</h1>

  <div class="card">
    <h2>Admin Authentication</h2>
    <p style="color:var(--muted);font-size:0.85rem;margin-bottom:12px;">Enter the DO_SHARED_SECRET to manage API keys</p>
    <input type="password" id="adminKey" class="admin-key-input" placeholder="Enter admin key (DO_SHARED_SECRET)" oninput="onAdminKeyChange()" autofocus>
    <div id="adminStatus" style="color:var(--danger);font-size:0.85rem;"></div>
  </div>

  <div id="adminContent" class="hidden">
    <div class="card">
      <h2>Issue New API Key</h2>
      <div class="form-row">
        <div class="form-group">
          <label>Key Name</label>
          <input type="text" id="keyName" placeholder="e.g. production-app-1" style="width:200px">
        </div>
        <div class="form-group">
          <label>Scope</label>
          <select id="keyScope" style="width:140px">
            <option value="*">All (*)</option>
            <option value="tasks">Tasks only</option>
            <option value="query">Query only</option>
            <option value="nodes">Nodes only</option>
          </select>
        </div>
        <button class="btn-primary" onclick="createKey()">Generate Key</button>
      </div>
      <div id="newKeyResult" class="hidden">
        <p style="color:var(--success);font-weight:600;margin:12px 0 4px;">Key generated (copy it now — it won't be shown again):</p>
        <div class="key-display" id="newKeyValue"></div>
        <button class="btn-sm" onclick="copyKey()">Copy to Clipboard</button>
      </div>
    </div>

    <div class="card">
      <h2>Existing API Keys</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Prefix</th>
            <th>Status</th>
            <th>Created</th>
            <th>Last Used</th>
            <th>Scopes</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="keysTableBody">
          <tr><td colspan="7" class="empty">No keys found</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
<script>
const STORAGE_KEY = 'flaxia_admin_key';
let adminKey = localStorage.getItem(STORAGE_KEY) || '';

function getUrl(path) { return window.location.origin + '/admin' + path; }

function toast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function onAdminKeyChange() {
  adminKey = document.getElementById('adminKey').value;
  if (adminKey) {
    localStorage.setItem(STORAGE_KEY, adminKey);
    document.getElementById('adminStatus').textContent = '';
    document.getElementById('adminContent').classList.remove('hidden');
    loadKeys();
  } else {
    localStorage.removeItem(STORAGE_KEY);
    document.getElementById('adminContent').classList.add('hidden');
  }
}

async function api(method, path, body) {
  const res = await fetch(getUrl(path), {
    method,
    headers: { 'X-Admin-Key': adminKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 403) {
    document.getElementById('adminStatus').textContent = 'Invalid admin key';
    document.getElementById('adminContent').classList.add('hidden');
    throw new Error('Invalid admin key');
  }
  return res.json();
}

async function loadKeys() {
  try {
    const data = await api('GET', '/api/keys');
    const tbody = document.getElementById('keysTableBody');
    if (!data.keys || data.keys.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No keys found</td></tr>';
      return;
    }
    tbody.innerHTML = data.keys.map(k => {
      const created = new Date(k.createdAt).toLocaleString();
      const lastUsed = k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never';
      const scopes = (k.scopes || ['*']).map(s => '<span class="scope-tag">' + s + '</span>').join('');
      const revokeBtn = k.status === 'active'
        ? '<button class="btn-danger btn-sm" onclick="revokeKey(\\'' + k.id + '\\')">Revoke</button>'
        : '';
      return '<tr><td>' + k.name + '</td><td><span class="key-prefix">' + (k.prefix || '-') + '...</span></td><td><span class="badge ' + k.status + '">' + k.status + '</span></td><td>' + created + '</td><td>' + lastUsed + '</td><td class="scopes">' + scopes + '</td><td>' + revokeBtn + '</td></tr>';
    }).join('');
  } catch {}
}

async function createKey() {
  const name = document.getElementById('keyName').value.trim();
  if (!name) { toast('Name is required', true); return; }
  try {
    const data = await api('POST', '/api/keys', { name, scopes: [document.getElementById('keyScope').value] });
    document.getElementById('newKeyResult').classList.remove('hidden');
    document.getElementById('newKeyValue').textContent = data.key;
    document.getElementById('keyName').value = '';
    toast('Key created: ' + data.name);
    await loadKeys();
  } catch {}
}

function copyKey() {
  const text = document.getElementById('newKeyValue').textContent;
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
}

async function revokeKey(id) {
  if (!confirm('Revoke this API key? This cannot be undone.')) return;
  try {
    await api('DELETE', '/api/keys/' + id);
    toast('Key revoked');
    await loadKeys();
  } catch {}
}

// Auto-restore admin key
if (adminKey) {
  document.getElementById('adminKey').value = adminKey;
  document.getElementById('adminContent').classList.remove('hidden');
  loadKeys();
}
</script>
</body>
</html>`)
})

// Admin API routes
app.get('/api/keys', async (c) => {
  if (!validateAdminKey(c.env, c.req.header(ADMIN_KEY_HEADER))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const id = c.env.API_KEY_MANAGER.idFromName('global-key-manager')
  const obj = c.env.API_KEY_MANAGER.get(id)
  const data = await obj.fetch(new Request('http://internal/list', {
    headers: { 'X-DO-Shared-Secret': c.env.DO_SHARED_SECRET },
  }))
  return c.json(await data.json())
})

app.post('/api/keys', async (c) => {
  if (!validateAdminKey(c.env, c.req.header(ADMIN_KEY_HEADER))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const { name, scopes } = await c.req.json() as { name: string; scopes?: string[] }
  if (!name || !name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const id = c.env.API_KEY_MANAGER.idFromName('global-key-manager')
  const obj = c.env.API_KEY_MANAGER.get(id)
  const data = await obj.fetch(new Request('http://internal/create', {
    method: 'POST',
    headers: { 'X-DO-Shared-Secret': c.env.DO_SHARED_SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), scopes }),
  }))
  const result = await data.json()
  return c.json(result)
})

app.delete('/api/keys/:id', async (c) => {
  if (!validateAdminKey(c.env, c.req.header(ADMIN_KEY_HEADER))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const id = c.req.param('id')
  const doId = c.env.API_KEY_MANAGER.idFromName('global-key-manager')
  const obj = c.env.API_KEY_MANAGER.get(doId)
  await obj.fetch(new Request(`http://internal/revoke/${id}`, {
    method: 'POST',
    headers: { 'X-DO-Shared-Secret': c.env.DO_SHARED_SECRET },
  }))
  return c.json({ message: 'Key revoked' })
})

export { app as adminApp }
