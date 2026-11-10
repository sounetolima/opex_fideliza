const test = require('node:test');
const assert = require('node:assert/strict');
const { createLicenseService } = require('../src/licenses');
const { memoryStore } = require('../src/store');

const SECRET = 'x'.repeat(40);
const make = () => createLicenseService({ store: memoryStore(), secret: SECRET, adminPassword: 'senha-do-admin' });
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

async function loggedIn(svc) {
  const { token } = await svc.route('POST', '/admin/login', { password: 'senha-do-admin' });
  return token;
}

test('senha do admin errada é recusada e a certa entra', async () => {
  const svc = make();
  await assert.rejects(svc.route('POST', '/admin/login', { password: 'errada' }), { status: 401 });
  assert.ok((await svc.route('POST', '/admin/login', { password: 'senha-do-admin' })).token);
});

test('rotas de admin exigem token', async () => {
  const svc = make();
  await assert.rejects(svc.route('GET', '/admin/licenses', {}, ''), { status: 401 });
});

test('criar licença com marca, verificar e receber a marca na extensão', async () => {
  const svc = make();
  const t = await loggedIn(svc);
  const r = await svc.route('POST', '/admin/create', { name: 'Clínica Sorriso', phone: '79999991234', email: 'Ana@Clinica.com', plan: 'Mensal', maxDevices: 1, days: 30, brand: { name: 'Sorriso Odonto', logo: LOGO } }, t);
  assert.ok(r.password && r.license.key.startsWith('CARE-'));
  const v = await svc.verify({ key: r.license.key, deviceId: 'pc1', version: '2.3.0' });
  assert.equal(v.ok, true);
  assert.equal(v.brand.name, 'Sorriso Odonto');
  assert.equal(v.brand.logo, LOGO);
});

test('limite de computadores é aplicado e liberado no painel', async () => {
  const svc = make();
  const t = await loggedIn(svc);
  const { license } = await svc.route('POST', '/admin/create', { name: 'A', plan: 'Mensal', maxDevices: 1, days: 30 }, t);
  assert.equal((await svc.verify({ key: license.key, deviceId: 'pc1' })).ok, true);
  const bloqueado = await svc.verify({ key: license.key, deviceId: 'pc2' });
  assert.equal(bloqueado.status, 'limit');
  await svc.route('POST', `/admin/license/${license.key}/reset-devices`, {}, t);
  assert.equal((await svc.verify({ key: license.key, deviceId: 'pc2' })).ok, true);
});

test('bloquear derruba o acesso na próxima verificação', async () => {
  const svc = make();
  const t = await loggedIn(svc);
  const { license } = await svc.route('POST', '/admin/create', { name: 'B', plan: 'Mensal', maxDevices: 2, days: 30 }, t);
  await svc.route('POST', `/admin/license/${license.key}/block`, {}, t);
  assert.equal((await svc.verify({ key: license.key, deviceId: 'pc1' })).status, 'blocked');
  await svc.route('POST', `/admin/license/${license.key}/unblock`, {}, t);
  assert.equal((await svc.verify({ key: license.key, deviceId: 'pc1' })).ok, true);
});

test('licença vencida é recusada', async () => {
  const store = memoryStore();
  const svc = createLicenseService({ store, secret: SECRET, adminPassword: 'senha-do-admin' });
  const t = await loggedIn(svc);
  const { license } = await svc.route('POST', '/admin/create', { name: 'C', plan: 'Mensal', maxDevices: 1, days: 30 }, t);
  const db = await store.load();
  db.licenses[0].expiresAt = Date.now() - 1000;
  await store.save(db);
  const v = await svc.verify({ key: license.key, deviceId: 'pc1' });
  assert.equal(v.ok, false);
  assert.equal(v.status, 'expired');
});

test('pedido do site fica pendente até a aprovação, que define o vencimento', async () => {
  const svc = make();
  const t = await loggedIn(svc);
  await svc.createOrder({ name: 'Dra. Cinthya', phone: '79998881234', email: 'c@x.com', plan: 'Anual', password: 'senha123' });
  const pend = await svc.route('GET', '/admin/licenses', {}, t);
  assert.equal(pend.kpi.pedidos, 1);
  const key = pend.items[0].key;
  assert.equal((await svc.verify({ key, deviceId: 'pc1' })).status, 'pending');
  const ap = await svc.route('POST', `/admin/license/${key}/approve`, {}, t);
  assert.equal(ap.license.effective, 'active');
  assert.ok(ap.license.expiresAt > Date.now() + 300 * 864e5);
  assert.equal((await svc.login({ login: 'c@x.com', password: 'senha123' })).ok, true);
  assert.equal((await svc.login({ login: '(79) 99888-1234', password: 'senha123' })).ok, true);
  assert.equal((await svc.login({ login: 'c@x.com', password: 'errada' })).ok, false);
});

test('atualizar marca de um cliente reflete na próxima verificação', async () => {
  const svc = make();
  const t = await loggedIn(svc);
  const { license } = await svc.route('POST', '/admin/create', { name: 'D', plan: 'Mensal', maxDevices: 1, days: 30, brand: { name: 'Antiga' } }, t);
  await svc.route('POST', `/admin/license/${license.key}/update`, { name: 'D', plan: 'Mensal', maxDevices: 1, brand: { name: 'Nova', logo: LOGO } }, t);
  const v = await svc.verify({ key: license.key, deviceId: 'pc1' });
  assert.equal(v.brand.name, 'Nova');
  assert.equal(v.brand.logo, LOGO);
});

test('logo inválida ou grande demais é recusada', async () => {
  const svc = make();
  const t = await loggedIn(svc);
  await assert.rejects(svc.route('POST', '/admin/create', { name: 'E', plan: 'Mensal', maxDevices: 1, days: 30, brand: { logo: 'javascript:alert(1)' } }, t), { status: 400 });
  await assert.rejects(svc.route('POST', '/admin/create', { name: 'E', plan: 'Mensal', maxDevices: 1, days: 30, brand: { logo: 'data:image/png;base64,' + 'A'.repeat(400000) } }, t), { status: 400 });
});

test('troca de senha do admin exige a senha atual', async () => {
  const svc = make();
  const t = await loggedIn(svc);
  await assert.rejects(svc.route('POST', '/admin/change-password', { current: 'errada', password: 'nova-senha-1' }, t), { status: 400 });
  await svc.route('POST', '/admin/change-password', { current: 'senha-do-admin', password: 'nova-senha-1' }, t);
  await assert.rejects(svc.route('POST', '/admin/login', { password: 'senha-do-admin' }), { status: 401 });
  assert.ok((await svc.route('POST', '/admin/login', { password: 'nova-senha-1' })).token);
});

test('teste grátis entra na hora por 3 dias e não aceita cadastro repetido', async () => {
  const svc = make();
  const r = await svc.createOrder({ name: 'Salão Bela', phone: '(79) 99777-1234', email: 'bela@x.com', plan: 'Teste', password: 'senha123', segment: 'saloes' });
  assert.equal(r.trial, true);
  const lg = await svc.login({ login: 'bela@x.com', password: 'senha123' });
  assert.equal(lg.ok, true);
  const dias = (lg.expiresAt - Date.now()) / 864e5;
  assert.ok(dias > 2.9 && dias <= 3);
  await assert.rejects(svc.createOrder({ name: 'Outro', phone: '79997771234', email: 'novo@x.com', plan: 'Teste', password: 'senha123' }), { status: 409 });
  await assert.rejects(svc.createOrder({ name: 'Outro', phone: '79911112222', email: 'BELA@x.com', plan: 'Mensal', password: 'senha123' }), { status: 409 });
});

test('pedido exige e-mail e WhatsApp válidos e ignora robôs', async () => {
  const svc = make();
  await assert.rejects(svc.createOrder({ name: 'A', phone: '123', email: 'a@x.com', plan: 'Teste', password: 'senha123' }), { status: 400 });
  await assert.rejects(svc.createOrder({ name: 'A', phone: '79911112222', email: 'sem-arroba', plan: 'Teste', password: 'senha123' }), { status: 400 });
  await assert.rejects(svc.createOrder({ name: 'A', phone: '79911112222', email: 'a@x.com', plan: 'Vitalício', password: 'senha123' }), { status: 400 });
  await svc.createOrder({ name: 'Robô', phone: '79911112222', email: 'r@x.com', plan: 'Teste', password: 'senha123', website: 'http://spam' });
  const t = await loggedIn(svc);
  assert.equal((await svc.route('GET', '/admin/licenses', {}, t)).items.length, 0);
});

test('painel trava depois de muitas senhas erradas do mesmo IP', async () => {
  const svc = make();
  for (let i = 0; i < 8; i++) await assert.rejects(svc.route('POST', '/admin/login', { password: 'x' }, '', '1.1.1.1'), { status: 401 });
  await assert.rejects(svc.route('POST', '/admin/login', { password: 'senha-do-admin' }, '', '1.1.1.1'), { status: 429 });
  assert.ok((await svc.route('POST', '/admin/login', { password: 'senha-do-admin' }, '', '2.2.2.2')).token);
});

test('plano semestral aprovado vale 180 dias', async () => {
  const svc = make();
  const t = await loggedIn(svc);
  await svc.createOrder({ name: 'Corretora', phone: '79955554444', email: 'co@x.com', plan: 'Semestral', password: 'senha123' });
  const key = (await svc.route('GET', '/admin/licenses', {}, t)).items[0].key;
  const ap = await svc.route('POST', `/admin/license/${key}/approve`, {}, t);
  const dias = (ap.license.expiresAt - Date.now()) / 864e5;
  assert.ok(dias > 179.9 && dias <= 180);
  assert.equal(ap.license.order.amount, 200);
});
