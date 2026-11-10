/* global chrome */
const KEY = 'opex_care_v1';
const $ = (id) => document.getElementById(id);
const msg = (t) => ($('msg').textContent = t);

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

load();
