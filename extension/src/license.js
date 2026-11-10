// Opex Fideliza — licença por cliente. Verificação feita no servidor da OPEX (via service worker).
/* global chrome, OA */
(() => {
  'use strict';
  const KEY = 'opex_license_v1';
  const RECHECK_MS = 6 * 3600e3;   // revalida a cada 6 h
  const GRACE_MS = 72 * 3600e3;    // sem internet: tolera até 72 h desde a última validação
  const L = (OA.license = { ok: false, loading: true, data: null, message: '', status: 'none', listeners: [] });

  // Marca do cliente (nome e logo) definida no painel do administrador: vale neste computador.
  const applyBrand = (b) => {
    if (!b || (!b.name && !b.logo) || !OA.store) return;
    OA.store.state.settings.brand = { name: b.name || '', logo: b.logo || '' };
    OA.store.commit(true);
  };

  const emit = () => L.listeners.forEach((f) => { try { f(L); } catch (_) {} });
  const save = () => chrome.storage.local.set({ [KEY]: L.data });
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const version = () => chrome.runtime.getManifest().version;

  function server(key, deviceId, extra) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'license-verify', product: 'opex-care', key, deviceId, version: version(), ...(extra || {}) }, (r) => {
        if (chrome.runtime.lastError || !r) return resolve({ network: true, message: 'Sem conexão com o servidor de licenças.' });
        resolve(r);
      });
    });
  }

  function apply() {
    const d = L.data || {};
    const now = Date.now();
    const last = d.last || null;
    let ok = false, status = 'none', message = '';
    if (!d.key) { status = 'none'; message = (last && last.message) || 'Entre com seu e-mail ou telefone e a senha.'; }
    else if (!last) { status = 'invalid'; message = 'Valide sua licença.'; }
    else if (last.ok) {
      if (last.expiresAt && last.expiresAt < now) { status = 'expired'; message = 'Licença vencida. Renove com a OPEX para continuar usando.'; }
      else if (now - d.okAt > GRACE_MS) { status = 'offline'; message = 'Não foi possível validar a licença há mais de 72 h. Conecte-se à internet.'; }
      else { ok = true; status = 'active'; message = last.message; }
    } else { status = last.status || 'invalid'; message = last.message || 'Licença inválida.'; }
    L.ok = ok; L.status = status; L.message = message; L.loading = false;
    L.trial = ok && last && last.trial ? { ...last.trial, endsAt: last.expiresAt } : null;
    emit();
  }

  L.check = async (force) => {
    const d = L.data;
    if (!d || !d.key) return apply();
    if (!force && d.last && d.last.ok && Date.now() - d.checkedAt < RECHECK_MS) return apply();
    const r = await server(d.key, d.deviceId, { wa: L.wa || '' });
    if (r.network) { apply(); return r; }       // sem rede: mantém a última validação (carência de 72 h)
    d.last = r; d.checkedAt = Date.now();
    if (r.ok) { d.okAt = d.checkedAt; applyBrand(r.brand); }
    await save();
    apply();
    return r;
  };

  L.activate = async (key) => {
    key = String(key || '').trim().toUpperCase();
    if (!key) { L.message = 'Digite a chave de licença.'; emit(); return { ok: false }; }
    const prev = L.data || {};
    L.data = { key, deviceId: prev.deviceId || randomId(), last: null, checkedAt: 0, okAt: 0 };
    const r = await L.check(true);
    if (r && r.network) { L.message = r.message; emit(); }
    return r;
  };

  // Login do cliente: e-mail ou telefone + senha. O servidor devolve a chave da licença.
  L.login = async (login, password) => {
    login = String(login || '').trim();
    if (!login || !password) { L.message = 'Informe e-mail ou telefone e a senha.'; emit(); return { ok: false }; }
    const prev = L.data || {};
    const deviceId = prev.deviceId || randomId();
    const r = await server('', deviceId, { path: 'login', login, password });
    if (r.network) { L.message = r.message; emit(); return r; }
    if (!r.ok) { L.data = { ...prev, deviceId, last: r, key: undefined }; L.message = r.message; L.status = r.status; apply(); return r; }
    L.data = { key: r.key, deviceId, last: r, checkedAt: Date.now(), okAt: Date.now() };
    applyBrand(r.brand);
    await save(); apply();
    // Valida em seguida para registrar este computador e aplicar o limite de computadores do plano.
    return await L.check(true);
  };

  // Número do WhatsApp conectado (para amarrar a degustação a ele).
  L.setWa = (wa) => {
    wa = String(wa || '').replace(/\D/g, '');
    if (!wa || wa === L.wa) return;
    L.wa = wa;
    if (L.trial && !L.trial.bound) L.check(true);
  };

  // Desconecta ESTE computador da licença (libera a vaga) e limpa a chave daqui.
  L.release = async () => {
    const d = L.data || {};
    if (!d.key || !d.deviceId) return { ok: false, message: 'Este computador não está conectado a uma licença.' };
    const r = await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'license-verify', path: 'release', key: d.key, deviceId: d.deviceId }, (x) => resolve(x || { ok: false, network: true, message: 'Sem conexão com o servidor de licenças.' })));
    if (!r.ok) { L.message = r.message; emit(); return r; }
    L.data = { deviceId: d.deviceId };
    await save(); apply();
    L.message = 'Computador desconectado. Digite a chave aqui para usar este computador de novo.';
    emit();
    return r;
  };

  L.deactivate = async () => {
    const id = L.data && L.data.deviceId;
    L.data = { deviceId: id || randomId() };
    await save(); apply();
  };

  L.init = async () => {
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    L.data = stored || { deviceId: randomId() };
    if (!L.data.deviceId) L.data.deviceId = randomId();
    apply();
    await L.check(false);
    setInterval(() => L.check(false), 30 * 60e3);
    // Mudou em outra aba (ativação/bloqueio): reflete aqui.
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch[KEY] && ch[KEY].newValue && JSON.stringify(ch[KEY].newValue) !== JSON.stringify(L.data)) {
        L.data = ch[KEY].newValue; apply();
      }
    });
  };
})();
