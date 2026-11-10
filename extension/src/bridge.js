// Opex Fideliza — ponte entre a extensão (mundo isolado) e o WhatsApp Web (mundo da página).
// Expõe um conjunto pequeno e fechado de ações; nada além disso é acessível pela extensão.
(() => {
  'use strict';
  if (window.__opexAgentBridge) return;
  window.__opexAgentBridge = true;

  const SRC_IN = 'opex-agent:cs';
  const SRC_OUT = 'opex-agent:page';
  const W = () => window.WPP;
  const post = (msg) => window.postMessage({ source: SRC_OUT, ...msg }, location.origin);

  const sid = (w) => (w && (w._serialized || (typeof w === 'string' ? w : ''))) || '';
  const phoneFromId = (id) => (id && id.endsWith('@c.us') ? id.split('@')[0] : '');

  async function resolvePhone(id) {
    const direct = phoneFromId(id);
    if (direct) return direct;
    if (!id || !id.endsWith('@lid')) return '';
    try {
      const r = await W().contact.getPnLidEntry(id);
      return (r && r.phoneNumber && r.phoneNumber.id) || '';
    } catch (_) {
      return '';
    }
  }

  function chatInfo(chat) {
    if (!chat) return null;
    const id = sid(chat.id);
    const c = chat.contact || {};
    return {
      id,
      name: String(chat.formattedTitle || chat.name || c.pushname || c.name || c.verifiedName || ''),
      isGroup: !!chat.isGroup || id.endsWith('@g.us'),
      phone: phoneFromId(id),
    };
  }

  const ACTIONS = {
    async status() {
      const wpp = W();
      let me = null;
      try { me = sid(wpp.conn.getMyUserId()); } catch (_) {}
      return { ready: !!(wpp && wpp.isReady), fullReady: !!(wpp && wpp.isFullReady), me };
    },
    async activeChat() {
      const info = chatInfo(W().chat.getActiveChat());
      if (info && !info.phone && !info.isGroup) info.phone = await resolvePhone(info.id);
      return info;
    },
    async resolve({ chatId }) {
      return { phone: await resolvePhone(chatId) };
    },
    async checkNumber({ phone }) {
      const digits = String(phone || '').replace(/\D/g, '');
      if (digits.length < 8) return null;
      const r = await W().contact.queryExists(digits + '@c.us');
      return r && r.wid ? { id: sid(r.wid) } : null;
    },
    async sendText({ chatId, text, typingMs }) {
      if (!chatId || !text) throw new Error('Contato ou mensagem vazia');
      const r = await W().chat.sendTextMessage(chatId, String(text), {
        createChat: true,
        delay: Math.max(0, Math.min(Number(typingMs) || 0, 8000)),
      });
      return { id: (r && sid(r.id)) || (r && r.id) || null };
    },
    async sendFile({ chatId, dataUrl, caption, filename }) {
      if (!chatId || !dataUrl) throw new Error('Contato ou arquivo vazio');
      const r = await W().chat.sendFileMessage(chatId, dataUrl, {
        type: 'auto-detect',
        caption: caption || undefined,
        filename: filename || undefined,
        createChat: true,
      });
      return { id: (r && sid(r.id)) || null };
    },
    async openChat({ chatId }) {
      try { await W().chat.find(chatId); } catch (_) {}
      return !!(await W().chat.openChatBottom(chatId));
    },
    async listContacts() {
      const list = await W().contact.list({ onlyMyContacts: true });
      const out = [];
      for (const c of list) {
        const id = sid(c.id);
        if (!id.endsWith('@c.us') && !id.endsWith('@lid')) continue;
        const phone = await resolvePhone(id);
        if (!phone) continue;
        out.push({ name: String(c.name || c.shortName || c.pushname || ''), phone });
      }
      return out;
    },
    async listChats({ count }) {
      const n = Number(count) || 60;
      const chats = await W().chat.list({ count: n > 150 ? Math.min(n, 5000) : Math.min(n, 150), onlyUsers: true });
      return chats.map((c) => {
        let snippet = '';
        try {
          const ms = c.msgs && (c.msgs.models || (c.msgs.getModelsArray && c.msgs.getModelsArray()));
          const m = ms && ms[ms.length - 1];
          if (m) snippet = String(m.body || m.caption || '') || ({ image: '📷 Imagem', video: '🎥 Vídeo', ptt: '🎤 Áudio', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Figurinha' }[m.type] || '');
        } catch (_) {}
        const id = sid(c.id);
        return { id, name: String(c.formattedTitle || c.name || (c.contact && (c.contact.pushname || c.contact.name)) || id.split('@')[0]), unread: Number(c.unreadCount) || 0, t: Number(c.t) || 0, snippet: snippet.slice(0, 90), phone: id.endsWith('@c.us') ? id.split('@')[0] : '' };
      }).sort((a, b) => b.t - a.t);
    },
    async listGroups() {
      const chats = await W().chat.list({ onlyGroups: true, count: 2000 });
      return chats.map((c) => ({ id: sid(c.id), name: String(c.formattedTitle || c.name || '') }));
    },
    async groupMembers({ chatId }) {
      const parts = await W().group.getParticipants(chatId);
      const out = [];
      for (const p of parts) {
        const id = sid(p.id);
        const phone = await resolvePhone(id);
        const c = p.contact || {};
        out.push({ name: String(c.name || c.pushname || ''), phone: phone || id.split('@')[0], admin: !!(p.isAdmin || p.isSuperAdmin) });
      }
      return out;
    },
    async setInput({ text, chatId }) {
      await W().chat.setInputText(String(text || ''), chatId || undefined);
      return true;
    },
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC_IN) return;
    const { id, action, payload } = e.data;
    try {
      const wpp = W();
      if (!wpp) throw new Error('Motor do WhatsApp não carregou. Recarregue a página.');
      if (action !== 'status' && !wpp.isReady) throw new Error('WhatsApp ainda está carregando');
      const fn = ACTIONS[action];
      if (!fn) throw new Error('Ação desconhecida: ' + action);
      const result = await fn(payload || {});
      post({ type: 'response', id, ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) });
    } catch (err) {
      post({ type: 'response', id, ok: false, error: String((err && err.message) || err) });
    }
  });

  function attachEvents() {
    const wpp = W();
    wpp.on('chat.active_chat', async (chat) => {
      const info = chatInfo(chat);
      if (info && !info.phone && !info.isGroup) info.phone = await resolvePhone(info.id);
      post({ type: 'event', event: 'active_chat', data: info });
    });
    wpp.on('chat.new_message', (msg) => {
      try {
        if (!msg || !msg.isNewMsg) return;
        const chatId = sid(msg.id && msg.id.remote) || sid(msg.from);
        if (!chatId || chatId === 'status@broadcast' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast')) return;
        post({
          type: 'event',
          event: 'new_message',
          data: {
            chatId,
            fromMe: !!(msg.id && msg.id.fromMe),
            body: typeof msg.body === 'string' && msg.type === 'chat' ? msg.body : (msg.caption || ''),
            msgType: msg.type || '',
            isGroup: chatId.endsWith('@g.us'),
            name: String(msg.notifyName || (msg.senderObj && msg.senderObj.pushname) || ''),
            ts: Number(msg.t) || Math.floor(Date.now() / 1000),
          },
        });
      } catch (_) {}
    });
    post({ type: 'event', event: 'ready', data: {} });
  }

  (function waitForWpp(tries) {
    const wpp = W();
    if (wpp && wpp.loader && typeof wpp.loader.onReady === 'function') {
      wpp.loader.onReady(attachEvents);
    } else if (wpp && wpp.webpack && typeof wpp.webpack.onReady === 'function') {
      wpp.webpack.onReady(attachEvents);
    } else if (tries < 120) {
      setTimeout(() => waitForWpp(tries + 1), 500);
    }
  })(0);
})();
