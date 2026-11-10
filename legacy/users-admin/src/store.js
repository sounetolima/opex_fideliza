// Armazenamento: memória (testes e desenvolvimento) ou Netlify Blobs (produção).
// Tudo fica em uma chave só, 'users', porque o volume de contas é pequeno.

function memoryStore() {
  const data = new Map();
  return {
    async load() { return data.get('users') || { users: [] }; },
    async save(db) { data.set('users', JSON.parse(JSON.stringify(db))); },
  };
}

function blobsStore(name = 'opex-care') {
  return {
    async load() {
      const { getStore } = require('@netlify/blobs');
      const db = await getStore(name).get('users', { type: 'json' });
      return db || { users: [] };
    },
    async save(db) {
      const { getStore } = require('@netlify/blobs');
      await getStore(name).setJSON('users', db);
    },
  };
}

module.exports = { memoryStore, blobsStore };
