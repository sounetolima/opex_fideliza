// Netlify: /api/* chega aqui. Painel em /admin/*; extensão em /verify, /login, /release, /backup e /order.
const { createLicenseService } = require('../../src/licenses');
const { blobsStore } = require('../../src/store');

// O formulário de pedido fica no site de vendas (outro endereço): só /order aceita chamadas de fora.
const SITE_ORIGINS = ['https://opex-fideliza-site.netlify.app'];
const json = (status, body, extra) => ({ statusCode: status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(extra || {}) }, body: JSON.stringify(body) });

let service;
exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const rawPath = (event.path || '').replace(/^.*\/\.netlify\/functions\/api/, '').replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const cors = rawPath === '/order' && SITE_ORIGINS.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin' } : {};
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  // Netlify entrega o contexto do Blobs no evento; sem isso o armazenamento não encontra o site.
  try { require('@netlify/blobs').connectLambda(event); } catch (_) {}
  try {
    if (!service) service = createLicenseService({ store: blobsStore(), secret: process.env.TOKEN_SECRET, adminPassword: process.env.ADMIN_PASSWORD });
    const path = (event.path || '').replace(/^.*\/\.netlify\/functions\/api/, '').replace(/^\/api/, '').replace(/\/+$/, '') || '/';
    const body = event.body ? JSON.parse(event.body) : {};
    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || '';
    return json(200, await service.route(event.httpMethod, path, body, token, ip), cors);
  } catch (e) {
    if (e.status) return json(e.status, { ok: false, message: e.message }, cors);
    console.error('[api]', e && e.stack ? e.stack : e);
    return json(500, { ok: false, message: 'Erro interno. Tente de novo.' });
  }
};
