// Licenças do Opex Fideliza: painel do administrador e verificação feita pela extensão.
// As rotas de admin usam token assinado; as da extensão são públicas e respondem no formato que a extensão espera.
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');

const DAY = 864e5;
const PLAN_DAYS = { Teste: 3, Mensal: 30, Semestral: 180, Anual: 365, 'Vitalício': null };
const PLAN_PRICE = { Mensal: 40, Semestral: 200, Anual: 350 };
const ORDER_PLANS = ['Teste', 'Mensal', 'Semestral', 'Anual'];
const SEEN_EVERY = 3600e3;      // só regrava o "visto por último" de hora em hora
const LOGIN_TRIES = 8;          // tentativas de senha do painel por IP
const LOGIN_WINDOW = 15 * 60e3; // a cada 15 minutos
const MAX_LOGO_CHARS = 300 * 1024; // logo em data URL, já reduzida no navegador

function createLicenseService({ store, secret, adminPassword }) {
  if (!secret) throw new Error('TOKEN_SECRET obrigatório');

  const fail = (status, message) => Object.assign(new Error(message), { status });
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const norm = (s) => String(s || '').trim().toLowerCase();
  const newKey = () => 'CARE-' + [0, 1, 2].map(() => crypto.randomBytes(2).toString('hex').toUpperCase()).join('-');
  const newPassword = () => crypto.randomBytes(8).toString('base64url').slice(0, 10);

  async function load() {
    const db = (await store.load()) || {};
    db.licenses = Array.isArray(db.licenses) ? db.licenses : [];
    db.settings = db.settings || { downloadUrl: '' };
    db.admin = db.admin || null;
    db.tries = db.tries || {};
    return db;
  }
  const save = (db) => store.save(db);

  function lastSeen(l) {
    const seen = (l.devices || []).map((d) => d.lastSeen || 0);
    return seen.length ? Math.max(...seen) : null;
  }

  function effective(l, now = Date.now()) {
    if (l.status === 'pending') return 'pending';
    if (l.status === 'blocked') return 'blocked';
    if (l.expiresAt && l.expiresAt < now) return 'expired';
    return 'active';
  }

  function publicLicense(l, now = Date.now()) {
    return {
      key: l.key, name: l.name || '', email: l.email || '', phone: l.phone || '',
      plan: l.plan, maxDevices: l.maxDevices, notes: l.notes || '',
      expiresAt: l.expiresAt, status: l.status, effective: effective(l, now),
      devices: l.devices || [], lastSeen: lastSeen(l), order: l.order || null,
      brand: l.brand || { name: '', logo: '' }, createdAt: l.createdAt,
    };
  }

  function sanitizeBrand(b, current = {}) {
    const src = b || {};
    const name = String(src.name !== undefined ? src.name : current.name || '').trim().slice(0, 60);
    let logo = src.logo !== undefined ? String(src.logo || '') : String(current.logo || '');
    if (logo && !/^data:image\/(png|jpeg|webp);base64,/.test(logo)) throw fail(400, 'A logo precisa ser uma imagem PNG, JPG ou WEBP.');
    if (logo.length > MAX_LOGO_CHARS) throw fail(400, 'Logo muito grande. Use uma imagem menor.');
    return { name, logo };
  }

  function sanitizeLicenseFields(v) {
    const name = String(v.name || '').trim();
    if (!name) throw fail(400, 'Informe o nome do cliente ou empresa.');
    const maxDevices = Number(v.maxDevices);
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) throw fail(400, 'Computadores permitidos: de 1 a 20.');
    return {
      name,
      phone: String(v.phone || '').trim(),
      email: norm(v.email),
      plan: String(v.plan || 'Mensal'),
      maxDevices,
      notes: String(v.notes || '').slice(0, 500),
    };
  }

  // ---------- admin ----------
  function requireAdmin(token) {
    const data = verifyToken(token, secret);
    if (!data || data.role !== 'admin') throw fail(401, 'Sessão expirada. Entre de novo.');
  }

  async function adminLogin(password, ip = '') {
    const db = await load();
    const now = Date.now();
    Object.keys(db.tries).forEach((k) => { if (now - db.tries[k].at > LOGIN_WINDOW) delete db.tries[k]; });
    const t = db.tries[ip || '-'];
    if (t && t.n >= LOGIN_TRIES) throw fail(429, 'Muitas tentativas. Aguarde 15 minutos.');
    const wrong = async () => { db.tries[ip || '-'] = { n: (t ? t.n : 0) + 1, at: t ? t.at : now }; await save(db); throw fail(401, 'Senha incorreta.'); };
    if (!db.admin) {
      if (!adminPassword || String(password) !== String(adminPassword)) await wrong();
      db.admin = { hash: hashPassword(password) };
      await save(db);
    } else if (!verifyPassword(password, db.admin.hash)) {
      await wrong();
    }
    return { ok: true, token: signToken({ role: 'admin' }, secret) };
  }

  async function changePassword({ current, password }) {
    const db = await load();
    if (!db.admin || !verifyPassword(current, db.admin.hash)) throw fail(400, 'Senha atual incorreta.');
    if (String(password || '').length < 8) throw fail(400, 'A nova senha precisa ter pelo menos 8 caracteres.');
    db.admin = { hash: hashPassword(password) };
    await save(db);
    return { ok: true, token: signToken({ role: 'admin' }, secret) };
  }

  async function listAll() {
    const db = await load();
    const now = Date.now();
    const items = db.licenses.map((l) => publicLicense(l, now));
    const kpi = {
      pedidos: items.filter((l) => l.order && l.order.status === 'pendente').length,
      total: items.length,
      active: items.filter((l) => l.effective === 'active').length,
      online24h: items.filter((l) => l.lastSeen && now - l.lastSeen < DAY).length,
      online7d: items.filter((l) => l.lastSeen && now - l.lastSeen < 7 * DAY).length,
      expiring7d: items.filter((l) => l.effective === 'active' && l.expiresAt && l.expiresAt - now < 7 * DAY).length,
      expired: items.filter((l) => l.effective === 'expired').length,
      blocked: items.filter((l) => l.effective === 'blocked').length,
      devices: items.reduce((n, l) => n + (l.devices || []).length, 0),
    };
    return { ok: true, now, kpi, items, settings: db.settings };
  }

  async function createLicense(body) {
    const fields = sanitizeLicenseFields(body);
    const days = Number(body.days) || 0;
    const db = await load();
    const now = Date.now();
    const password = newPassword();
    const l = {
      key: newKey(), ...fields, status: 'active',
      expiresAt: days > 0 ? now + days * DAY : null,
      devices: [], pwHash: hashPassword(password), brand: sanitizeBrand(body.brand), order: null, createdAt: now,
    };
    db.licenses.push(l);
    await save(db);
    return { ok: true, license: publicLicense(l, now), password };
  }

  function findLicense(db, key) {
    const l = db.licenses.find((x) => x.key === String(key || '').toUpperCase());
    if (!l) throw fail(404, 'Licença não encontrada.');
    return l;
  }

  async function licenseAction(key, action, body) {
    const db = await load();
    const l = findLicense(db, key);
    const now = Date.now();
    switch (action) {
      case 'update': {
        Object.assign(l, sanitizeLicenseFields(body));
        if (body.brand) l.brand = sanitizeBrand(body.brand, l.brand);
        break;
      }
      case 'extend': {
        const days = Number(body.days) || 30;
        if (l.expiresAt !== null) l.expiresAt = Math.max(now, l.expiresAt || now) + days * DAY;
        if (l.status === 'blocked') l.status = 'active';
        break;
      }
      case 'block': l.status = 'blocked'; break;
      case 'unblock': l.status = 'active'; break;
      case 'reset-devices': l.devices = []; break;
      case 'set-password': {
        const password = newPassword();
        l.pwHash = hashPassword(password);
        await save(db);
        return { ok: true, password };
      }
      case 'delete': db.licenses = db.licenses.filter((x) => x !== l); break;
      case 'approve': {
        if (!l.order) throw fail(400, 'Esta licença não tem pedido.');
        const days = PLAN_DAYS[l.plan];
        l.status = 'active';
        l.expiresAt = days ? now + days * DAY : null;
        l.order.status = 'aprovado';
        break;
      }
      case 'reject': {
        if (!l.order) throw fail(400, 'Esta licença não tem pedido.');
        l.order.status = 'recusado';
        l.status = 'blocked';
        break;
      }
      default: throw fail(404, 'Ação não encontrada.');
    }
    await save(db);
    return { ok: true, license: publicLicense(l, now) };
  }

  async function saveSettings(body) {
    const db = await load();
    db.settings = { ...db.settings, downloadUrl: String(body.downloadUrl || '').trim().slice(0, 300) };
    await save(db);
    return { ok: true };
  }

  // ---------- site: pedido de assinatura (fica pendente até o administrador aprovar) ----------
  async function createOrder(body) {
    const fields = sanitizeLicenseFields({ ...body, maxDevices: body.maxDevices || 1 });
    if (!ORDER_PLANS.includes(fields.plan)) throw fail(400, 'Plano inválido.');
    if (body.website) return { ok: true, message: 'Pedido recebido.' }; // campo-isca: robôs preenchem, pessoas não
    if (digits(fields.phone).length < 10) throw fail(400, 'Informe o WhatsApp com DDD.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) throw fail(400, 'Informe um e-mail válido.');
    if (String(body.password || '').length < 8) throw fail(400, 'A senha precisa ter pelo menos 8 caracteres.');
    const db = await load();
    const now = Date.now();
    const dup = db.licenses.find((x) => (x.email && x.email === fields.email) || (digits(x.phone) && digits(x.phone).slice(-10) === digits(fields.phone).slice(-10)));
    if (dup) throw fail(409, 'Já existe um cadastro com este e-mail ou WhatsApp. Fale com a gente no WhatsApp para liberar ou renovar.');
    const trial = fields.plan === 'Teste';
    const segment = String(body.segment || '').slice(0, 40);
    const l = {
      key: newKey(), ...fields, notes: segment ? 'Segmento: ' + segment : '',
      // Teste grátis entra na hora (3 dias, 1 computador). Planos pagos aguardam a aprovação no painel.
      status: trial ? 'active' : 'pending', expiresAt: trial ? now + PLAN_DAYS.Teste * DAY : null, devices: [],
      pwHash: hashPassword(body.password), brand: { name: '', logo: '' },
      order: { status: trial ? 'aprovado' : 'pendente', label: trial ? 'Teste grátis 3 dias' : fields.plan, amount: PLAN_PRICE[fields.plan] || null, createdAt: now }, createdAt: now,
    };
    db.licenses.push(l);
    await save(db);
    return trial
      ? { ok: true, trial: true, downloadUrl: db.settings.downloadUrl || '', message: 'Teste liberado por 3 dias. Instale a extensão e entre com seu e-mail e a senha.' }
      : { ok: true, trial: false, message: 'Pedido recebido. Vamos confirmar o pagamento e liberar seu acesso pelo WhatsApp.' };
  }

  // ---------- extensão ----------
  function clientStatusMessage(status, l) {
    if (status === 'pending') return 'Seu pedido está em análise. Aguarde a liberação.';
    if (status === 'blocked') return 'Acesso bloqueado. Fale com a OPEX.';
    if (status === 'expired') return 'Licença vencida. Renove com a OPEX para continuar usando.';
    return 'Licença ativa.';
  }

  async function verify(body) {
    const db = await load();
    const l = db.licenses.find((x) => x.key === String(body.key || '').trim().toUpperCase());
    if (!l) return { ok: false, status: 'invalid', message: 'Chave de licença não encontrada.' };
    const now = Date.now();
    const status = effective(l, now);
    if (status !== 'active') return { ok: false, status, message: clientStatusMessage(status), expiresAt: l.expiresAt };
    const deviceId = String(body.deviceId || '');
    if (!deviceId) return { ok: false, status: 'invalid', message: 'Computador não identificado.' };
    const dev = (l.devices || []).find((d) => d.id === deviceId);
    if (!dev) {
      if ((l.devices || []).length >= l.maxDevices) {
        return { ok: false, status: 'limit', message: `Limite de ${l.maxDevices} computador(es) atingido. Libere um computador no painel.` };
      }
      l.devices = [...(l.devices || []), { id: deviceId, version: String(body.version || ''), lastSeen: now }];
      await save(db);
    } else if (now - (dev.lastSeen || 0) > SEEN_EVERY || (body.version && body.version !== dev.version)) {
      dev.lastSeen = now;
      dev.version = String(body.version || dev.version || '');
      await save(db);
    }
    return {
      ok: true, status: 'active', message: 'Licença ativa.', key: l.key, plan: l.plan,
      expiresAt: l.expiresAt, brand: l.brand || { name: '', logo: '' },
      devices: l.devices.length, maxDevices: l.maxDevices,
    };
  }

  async function login({ login: id, password }) {
    const db = await load();
    const byEmail = norm(id);
    const byPhone = digits(id);
    const l = db.licenses.find((x) => (byEmail && x.email === byEmail) || (byPhone && digits(x.phone) === byPhone));
    if (!l || !verifyPassword(password, l.pwHash)) return { ok: false, status: 'invalid', message: 'Login ou senha inválidos.' };
    const status = effective(l);
    if (status !== 'active') return { ok: false, status, message: clientStatusMessage(status) };
    return { ok: true, key: l.key, plan: l.plan, expiresAt: l.expiresAt, brand: l.brand || { name: '', logo: '' }, message: 'Login confirmado.' };
  }

  async function release({ key, deviceId }) {
    const db = await load();
    const l = db.licenses.find((x) => x.key === String(key || '').toUpperCase());
    if (l) { l.devices = (l.devices || []).filter((d) => d.id !== deviceId); await save(db); }
    return { ok: true };
  }

  // ---------- roteamento ----------
  const ADMIN_OPEN = ['/admin/login', '/admin/forgot', '/admin/reset'];

  async function route(method, path, body = {}, token = '', ip = '') {
    if (path.startsWith('/admin/') && !ADMIN_OPEN.includes(path)) requireAdmin(token);
    if (method === 'POST' && path === '/admin/login') return adminLogin(body.password, ip);
    if (method === 'POST' && path === '/admin/forgot') return { ok: true, message: 'Recuperação por e-mail ainda não está ativa. Peça a redefinição ao suporte técnico.' };
    if (method === 'POST' && path === '/admin/reset') throw fail(400, 'Link de redefinição indisponível.');
    if (method === 'POST' && path === '/admin/change-password') return changePassword(body);
    if (method === 'GET' && path === '/admin/licenses') return listAll();
    if (method === 'POST' && path === '/admin/create') return createLicense(body);
    if (method === 'POST' && path === '/admin/settings') return saveSettings(body);
    const m = path.match(/^\/admin\/license\/([^/]+)\/([a-z-]+)$/);
    if (method === 'POST' && m) return licenseAction(m[1], m[2], body);
    if (method === 'POST' && path === '/order') return createOrder(body);
    if (method === 'POST' && path === '/verify') return verify(body);
    if (method === 'POST' && path === '/login') return login(body);
    if (method === 'POST' && path === '/release') return release(body);
    if (method === 'POST' && path === '/backup') return { ok: false, message: 'Backup na nuvem ainda não está disponível nesta versão.' };
    throw fail(404, 'Rota não encontrada.');
  }

  return { route, verify, login, createOrder, requireAdmin };
}

module.exports = { createLicenseService, PLAN_DAYS, PLAN_PRICE };
