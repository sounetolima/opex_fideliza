// Opex Fideliza — service worker: relógio dos agendamentos e notificações.
/* global chrome */

const KEY = 'opex_care_v1';
const WA_URL = 'https://web.whatsapp.com/';

function ensureAlarm() {
  chrome.alarms.get('opex-tick', (a) => {
    if (!a) chrome.alarms.create('opex-tick', { periodInMinutes: 1 });
  });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

async function waTabs() {
  return chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'opex-tick') return;
  const tabs = await waTabs();
  if (tabs.length) {
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'tick' }).catch(() => {});
    return;
  }
  // WhatsApp Web fechado: avisa (uma vez por lote) que há retornos ou disparos aguardando.
  const data = (await chrome.storage.local.get(KEY))[KEY];
  if (!data || !data.contacts) return;
  const now = Date.now();
  const contacts = Object.values(data.contacts);
  const dueFu = contacts.reduce((n, c) => n + (c.followups || []).filter((f) => f.status === 'pending' && f.ts <= now).length, 0);
  const pendingQ = (data.queue || []).filter((q) => q.status === 'pending').length;
  if (!dueFu && !pendingQ) return;
  if (data.notifiedAt && now - data.notifiedAt < 60 * 60e3) return;
  data.notifiedAt = now;
  await chrome.storage.local.set({ [KEY]: data });
  notify('Opex Fideliza: envios aguardando', `${dueFu} retorno(s) e ${pendingQ} mensagem(ns) na fila. Abra o WhatsApp Web para enviar.`, 'open-wa');
});

function notify(title, message, id) {
  chrome.notifications.create(id ? id + ':' + Date.now() : '', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: String(title || 'Opex Fideliza').slice(0, 120),
    message: String(message || '').slice(0, 300),
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const tabs = await waTabs();
  if (tabs.length) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
  } else if (id.startsWith('open-wa')) {
    chrome.tabs.create({ url: WA_URL });
  }
  chrome.notifications.clear(id);
});

const API = 'https://opex-care-licencas.netlify.app/api/';
async function verifyLicense(msg) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(API + (['login', 'backup', 'release'].includes(msg.path) ? msg.path : 'verify'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify(msg.payload || { product: 'opex-care', key: msg.key, login: msg.login, password: msg.password, deviceId: msg.deviceId, version: msg.version, wa: msg.wa }),
    });
    clearTimeout(t);
    if (!r.ok) return { network: true, message: 'Servidor de licenças indisponível (' + r.status + ').' };
    return await r.json();
  } catch (_) {
    return { network: true, message: 'Sem conexão com o servidor de licenças.' };
  }
}

// Token do Google (somente leitura da agenda). Fica no service worker; a página só pede o token.
function getGoogleToken(interactive) {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: !!interactive }, (token) => {
      if (chrome.runtime.lastError || !token) resolve({ error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Sem token' });
      else resolve({ token });
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'gcal-token') {
    getGoogleToken(msg.interactive).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'gcal-revoke') {
    chrome.identity.getAuthToken({ interactive: false }, (t) => {
      if (t) chrome.identity.removeCachedAuthToken({ token: t }, () => sendResponse({ ok: true }));
      else sendResponse({ ok: true });
    });
    return true;
  }
  if (msg && msg.type === 'license-verify') {
    verifyLicense(msg).then(sendResponse);
    return true; // resposta assíncrona
  }
  if (msg && msg.type === 'notify') {
    notify(msg.title, msg.message, 'open-wa');
    sendResponse({ ok: true });
  }
  return false;
});
