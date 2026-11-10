// Rotas do admin. Netlify encaminha /api/admin/* para esta função.
const { createUsersService } = require('../../src/users');
const { blobsStore } = require('../../src/store');

const json = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(body) });

let service;
async function getService() {
  if (service) return service;
  const secret = process.env.TOKEN_SECRET;
  if (!secret) throw Object.assign(new Error('Servidor sem TOKEN_SECRET configurado.'), { status: 500 });
  service = createUsersService({ store: blobsStore(), secret });
  // Primeiro acesso: cria o administrador a partir das variáveis de ambiente, se ainda não existir.
  if (process.env.ADMIN_LOGIN && process.env.ADMIN_PASSWORD) await service.ensureAdmin(process.env.ADMIN_LOGIN, process.env.ADMIN_PASSWORD);
  return service;
}

exports.handler = async (event) => {
  // Netlify entrega o contexto do Blobs no evento; sem isso o armazenamento não encontra o site.
  try { require('@netlify/blobs').connectLambda(event); } catch (_) {}
  try {
    const svc = await getService();
    const path = (event.path || '').replace(/^\/\.netlify\/functions\/admin/, '').replace(/^\/api\/admin/, '').replace(/\/+$/, '');
    const method = event.httpMethod;
    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    const body = event.body ? JSON.parse(event.body) : {};

    if (method === 'POST' && path === '/login') return json(200, await svc.login(body.login, body.password));
    if (method === 'GET' && path === '/users') return json(200, { users: await svc.listUsers(token) });
    if (method === 'POST' && path === '/users') return json(201, { user: await svc.createUser(token, body) });
    const m = path.match(/^\/users\/([^/]+)$/);
    if (method === 'PATCH' && m) return json(200, { user: await svc.updateUser(token, m[1], body) });
    return json(404, { error: 'Rota não encontrada.' });
  } catch (e) {
    console.error('[admin]', e && e.stack ? e.stack : e);
    return json(e.status || 500, { error: e.status ? e.message : 'Erro interno. Tente de novo.' });
  }
};
