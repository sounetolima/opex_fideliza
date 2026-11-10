// Regras de negócio: admin bootstrap, login e gestão de usuários com perfis.
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');

// Perfis: admin gerencia tudo; financeiro vê o caixa; atendente vê agenda e clientes.
const ROLES = {
  admin: ['users', 'finance', 'agenda', 'clients'],
  financeiro: ['finance', 'agenda', 'clients'],
  atendente: ['agenda', 'clients'],
};

function createUsersService({ store, secret }) {
  if (!secret) throw new Error('TOKEN_SECRET obrigatório');

  const norm = (s) => String(s || '').trim().toLowerCase();
  const publicUser = (u) => ({ id: u.id, login: u.login, name: u.name, role: u.role, unit: u.unit || '', active: u.active, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null });

  async function ensureAdmin(login, password) {
    const db = await store.load();
    if (db.users.some((u) => u.role === 'admin')) return false;
    db.users.push({ id: crypto.randomUUID(), login: norm(login), name: 'Administrador', role: 'admin', unit: '', active: true, passwordHash: hashPassword(password), createdAt: Date.now() });
    await store.save(db);
    return true;
  }

  async function login(loginValue, password) {
    const db = await store.load();
    const u = db.users.find((x) => x.login === norm(loginValue));
    // Mesma mensagem para usuário inexistente e senha errada: não revela contas.
    if (!u || !u.active || !verifyPassword(password, u.passwordHash)) {
      const err = new Error('Login ou senha inválidos.'); err.status = 401; throw err;
    }
    u.lastLoginAt = Date.now();
    await store.save(db);
    return { token: signToken({ sub: u.id, role: u.role }, secret), user: publicUser(u) };
  }

  async function authenticate(token) {
    const data = verifyToken(token, secret);
    if (!data) { const err = new Error('Sessão inválida ou expirada.'); err.status = 401; throw err; }
    const db = await store.load();
    const u = db.users.find((x) => x.id === data.sub);
    if (!u || !u.active) { const err = new Error('Usuário inativo.'); err.status = 401; throw err; }
    return u;
  }

  function can(role, area) { return (ROLES[role] || []).includes(area); }

  async function requireArea(token, area) {
    const u = await authenticate(token);
    if (!can(u.role, area)) { const err = new Error('Sem permissão para esta área.'); err.status = 403; throw err; }
    return u;
  }

  async function listUsers(token) {
    await requireArea(token, 'users');
    const db = await store.load();
    return db.users.map(publicUser);
  }

  async function createUser(token, { login: loginValue, password, name, role, unit }) {
    await requireArea(token, 'users');
    const l = norm(loginValue);
    if (!l || !password || String(password).length < 8) { const err = new Error('Informe login e senha com pelo menos 8 caracteres.'); err.status = 400; throw err; }
    if (!ROLES[role]) { const err = new Error('Perfil inválido. Use admin, financeiro ou atendente.'); err.status = 400; throw err; }
    const db = await store.load();
    if (db.users.some((x) => x.login === l)) { const err = new Error('Já existe um usuário com este login.'); err.status = 409; throw err; }
    const u = { id: crypto.randomUUID(), login: l, name: String(name || '').trim() || l, role, unit: String(unit || '').trim(), active: true, passwordHash: hashPassword(password), createdAt: Date.now() };
    db.users.push(u);
    await store.save(db);
    return publicUser(u);
  }

  async function updateUser(token, id, patch) {
    const actor = await requireArea(token, 'users');
    const db = await store.load();
    const u = db.users.find((x) => x.id === id);
    if (!u) { const err = new Error('Usuário não encontrado.'); err.status = 404; throw err; }
    const wouldLoseAdmin = (patch.role && patch.role !== 'admin') || patch.active === false;
    if (u.role === 'admin' && wouldLoseAdmin && db.users.filter((x) => x.role === 'admin' && x.active).length <= 1) {
      const err = new Error('Não é possível remover o último administrador ativo.'); err.status = 400; throw err;
    }
    if (u.id === actor.id && patch.active === false) { const err = new Error('Você não pode desativar a própria conta.'); err.status = 400; throw err; }
    if (patch.role !== undefined) { if (!ROLES[patch.role]) { const err = new Error('Perfil inválido.'); err.status = 400; throw err; } u.role = patch.role; }
    if (patch.name !== undefined) u.name = String(patch.name).trim() || u.login;
    if (patch.unit !== undefined) u.unit = String(patch.unit).trim();
    if (patch.active !== undefined) u.active = !!patch.active;
    if (patch.password) {
      if (String(patch.password).length < 8) { const err = new Error('A senha precisa ter pelo menos 8 caracteres.'); err.status = 400; throw err; }
      u.passwordHash = hashPassword(patch.password);
    }
    await store.save(db);
    return publicUser(u);
  }

  return { ensureAdmin, login, authenticate, can, requireArea, listUsers, createUser, updateUser, ROLES };
}

module.exports = { createUsersService, ROLES };
