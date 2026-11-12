/* global chrome */
const KEY = 'opex_care_v1';
const LIC_KEY = 'opex_license_v1';
const GRACE_MS = 72 * 3600e3;
const $ = (id) => document.getElementById(id);
const msg = (t) => ($('msg').textContent = t);
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const version = () => chrome.runtime.getManifest().version;

// Mesma regra da licença do painel: válida se o último check foi ok e está dentro da carência.
function licensed(d) {
  const last = d && d.last;
  if (!last || !last.ok || !d.okAt) return false;
  if (last.expiresAt && last.expiresAt < Date.now()) return false;
  return Date.now() - d.okAt <= GRACE_MS;
}

// Envia ao servidor pelo service worker (mesma rota usada pelo painel).
function server(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'license-verify', ...payload }, (r) => {
      if (chrome.runtime.lastError || !r) return resolve({ network: true, message: 'Sem conexão com o servidor de licenças.' });
      resolve(r);
    });
  });
}

async function saveLicense(d) { await chrome.storage.local.set({ [LIC_KEY]: d }); }

async function activate(key, deviceId) {
  const r = await server({ key, deviceId, version: version() });
  if (r.network) return msg(r.message);
  if (!r.ok) return msg(r.message || 'Licença inválida.');
  await saveLicense({ key, deviceId, last: r, checkedAt: Date.now(), okAt: Date.now() });
  await showFor();
}

async function showFor() {
  const lic = (await chrome.storage.local.get(LIC_KEY))[LIC_KEY] || {};
  const ok = licensed(lic);
  $('app').hidden = !ok;
  $('lock').hidden = ok;
  if (ok) load();
  else $('lock-msg').textContent = (lic.last && lic.last.message) || 'Entre com seu e-mail ou telefone e a senha, ou digite a chave.';
}

$('lk-go').addEventListener('click', async () => {
  const login = $('lk-login').value.trim();
  const password = $('lk-pass').value;
  if (!login || !password) return msg('Informe e-mail ou telefone e a senha.');
  msg('Entrando...');
  const cur = (await chrome.storage.local.get(LIC_KEY))[LIC_KEY] || {};
  const deviceId = cur.deviceId || randomId();
  const r = await server({ path: 'login', login, password, deviceId });
  if (r.network) return msg(r.message);
  if (!r.ok || !r.key) return msg(r.message || 'Login inválido.');
  await activate(r.key, deviceId);
});

$('lk-key-go').addEventListener('click', async () => {
  const key = $('lk-key').value.trim().toUpperCase();
  if (!key) return msg('Digite a chave de licença.');
  msg('Validando...');
  const cur = (await chrome.storage.local.get(LIC_KEY))[LIC_KEY] || {};
  await activate(key, cur.deviceId || randomId());
});

async function load() {
  const d = (await chrome.storage.local.get(KEY))[KEY] || {};
  const contacts = Object.values(d.contacts || {});
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  $('k-leads').textContent = contacts.length;
  $('k-sched').textContent = contacts.reduce((n, c) => n + (c.followups || []).filter((f) => f.status === 'pending').length, 0);
  $('k-follow').textContent = contacts.reduce((n, c) => n + (c.followups || []).filter((f) => f.status === 'pending' && f.ts <= endOfDay.getTime()).length, 0);
  const n = new Date(); const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  $('k-sent').textContent = d.stats && d.stats.date === today ? d.stats.sent : 0;
  return d;
}

$('open').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
  }
  window.close();
});

$('export').addEventListener('click', async () => {
  const d = (await chrome.storage.local.get(KEY))[KEY] || {};
  const blob = new Blob([JSON.stringify({ app: 'opex-agent', exportedAt: new Date().toISOString(), data: d }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'opex-agent-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  msg('Backup exportado.');
});

$('import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const parsed = JSON.parse(await f.text());
    const data = parsed && parsed.app === 'opex-agent' ? parsed.data : parsed;
    if (!data || typeof data !== 'object' || !data.contacts) throw new Error('Arquivo não é um backup do Opex Fideliza');
    if (!confirm('Substituir todos os dados atuais por este backup?')) return;
    await chrome.storage.local.set({ [KEY]: data });
    await load();
    msg('Backup importado. Recarregue o WhatsApp Web.');
  } catch (err) {
    msg('Erro: ' + err.message);
  }
  e.target.value = '';
});

showFor();
