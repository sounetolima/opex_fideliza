const { test } = require('node:test');
const assert = require('node:assert/strict');
const { memoryStore } = require('../src/store');
const { createUsersService } = require('../src/users');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('../src/auth');

const SECRET = 'segredo-de-teste-com-tamanho-suficiente';
async function setup() {
  const svc = createUsersService({ store: memoryStore(), secret: SECRET });
  await svc.ensureAdmin('dono@opex.com', 'senha-admin-123');
  const { token } = await svc.login('dono@opex.com', 'senha-admin-123');
  return { svc, token };
}

test('senha é guardada com hash e verificada corretamente', () => {
  const h = hashPassword('minha-senha-1');
  assert.ok(!h.includes('minha-senha-1'));
  assert.equal(verifyPassword('minha-senha-1', h), true);
  assert.equal(verifyPassword('outra-senha', h), false);
});

test('token expira e não aceita adulteração', () => {
  const t = signToken({ sub: 'x', role: 'admin' }, SECRET, 1000);
  assert.ok(verifyToken(t, SECRET));
  assert.equal(verifyToken(t, 'outro-segredo'), null);
  assert.equal(verifyToken(signToken({ sub: 'x' }, SECRET, -1), SECRET), null);
  const [b, s] = t.split('.');
  assert.equal(verifyToken(b + 'x.' + s, SECRET), null);
});

test('admin é criado uma única vez', async () => {
  const { svc } = await setup();
  assert.equal(await svc.ensureAdmin('outro@opex.com', 'senha-admin-456'), false);
});

test('login errado não revela se a conta existe', async () => {
  const { svc } = await setup();
  await assert.rejects(svc.login('dono@opex.com', 'errada-123'), { status: 401, message: 'Login ou senha inválidos.' });
  await assert.rejects(svc.login('ninguem@opex.com', 'qualquer-123'), { status: 401, message: 'Login ou senha inválidos.' });
});

test('admin cria atendente e atendente faz login', async () => {
  const { svc, token } = await setup();
  const u = await svc.createUser(token, { login: 'Ana@Clinica.com', password: 'atendente-123', name: 'Ana', role: 'atendente', unit: 'Centro' });
  assert.equal(u.login, 'ana@clinica.com');
  assert.equal(u.passwordHash, undefined);
  const r = await svc.login('ana@clinica.com', 'atendente-123');
  assert.equal(r.user.role, 'atendente');
});

test('perfis: atendente não vê financeiro nem gerencia usuários', async () => {
  const { svc, token } = await setup();
  await svc.createUser(token, { login: 'at@x.com', password: 'atendente-123', role: 'atendente' });
  const { token: at } = await svc.login('at@x.com', 'atendente-123');
  await assert.rejects(svc.requireArea(at, 'finance'), { status: 403 });
  await assert.rejects(svc.listUsers(at), { status: 403 });
  await assert.doesNotReject(svc.requireArea(at, 'agenda'));
});

test('perfil financeiro vê caixa mas não gerencia usuários', async () => {
  const { svc, token } = await setup();
  await svc.createUser(token, { login: 'fin@x.com', password: 'financeiro-123', role: 'financeiro' });
  const { token: fin } = await svc.login('fin@x.com', 'financeiro-123');
  await assert.doesNotReject(svc.requireArea(fin, 'finance'));
  await assert.rejects(svc.createUser(fin, { login: 'b@x.com', password: 'senha-forte-1', role: 'atendente' }), { status: 403 });
});

test('não cria login duplicado nem senha curta', async () => {
  const { svc, token } = await setup();
  await svc.createUser(token, { login: 'dup@x.com', password: 'senha-forte-1', role: 'atendente' });
  await assert.rejects(svc.createUser(token, { login: 'DUP@x.com', password: 'senha-forte-2', role: 'atendente' }), { status: 409 });
  await assert.rejects(svc.createUser(token, { login: 'novo@x.com', password: 'curta', role: 'atendente' }), { status: 400 });
});

test('desativar usuário impede login e não é possível desativar a si mesmo', async () => {
  const { svc, token } = await setup();
  const u = await svc.createUser(token, { login: 'off@x.com', password: 'senha-forte-1', role: 'atendente' });
  await svc.updateUser(token, u.id, { active: false });
  await assert.rejects(svc.login('off@x.com', 'senha-forte-1'), { status: 401 });
  const me = (await svc.listUsers(token)).find((x) => x.role === 'admin');
  await assert.rejects(svc.updateUser(token, me.id, { active: false }), { status: 400 });
});

test('não remove o último administrador ativo', async () => {
  const { svc, token } = await setup();
  const admin = (await svc.listUsers(token)).find((x) => x.role === 'admin');
  await assert.rejects(svc.updateUser(token, admin.id, { role: 'atendente' }), { status: 400 });
});

test('admin troca a senha de um atendente', async () => {
  const { svc, token } = await setup();
  const u = await svc.createUser(token, { login: 'troca@x.com', password: 'senha-velha-1', role: 'atendente' });
  await svc.updateUser(token, u.id, { password: 'senha-nova-123' });
  await assert.rejects(svc.login('troca@x.com', 'senha-velha-1'), { status: 401 });
  await assert.doesNotReject(svc.login('troca@x.com', 'senha-nova-123'));
});

test('sem token válido nada é acessível', async () => {
  const { svc } = await setup();
  await assert.rejects(svc.listUsers('lixo'), { status: 401 });
});
