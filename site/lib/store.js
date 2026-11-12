// Armazenamento: memória (testes) ou Netlify Blobs (produção). Tudo em uma chave só: 'db'.

function memoryStore() {
  let data = null;
  return {
    async load() { return data ? JSON.parse(JSON.stringify(data)) : {}; },
    async save(db) { data = JSON.parse(JSON.stringify(db)); },
  };
}

function blobsStore(name = 'opex-care-licenses') {
  return {
    async load() {
      const { getStore } = require('@netlify/blobs');
      return (await getStore({ name, consistency: 'eventual' }).get('db', { type: 'json' })) || {};
    },
    async save(db) {
      const { getStore } = require('@netlify/blobs');
      await getStore({ name, consistency: 'eventual' }).setJSON('db', db);
    },
  };
}

module.exports = { memoryStore, blobsStore };
