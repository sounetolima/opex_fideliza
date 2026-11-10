// Opex Fideliza — motor: envios com segurança, pós-atendimento programado e disparos em massa.
/* global OA */
(() => {
  'use strict';
  const U = OA.util;
  const S = OA.store;
  const B = OA.bridge;
  const set = () => S.state.settings;

  const E = (OA.engine = { ready: false, running: false });

  // Fila única: nunca dois envios ao mesmo tempo.
  let chain = Promise.resolve();
  E.queue = (fn) => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };

  const licensed = () => !!(OA.license && OA.license.ok);

  async function resolveChatId(target) {
    if (target.chatId) return target.chatId;
    const phone = U.normalizePhone(target.phone, set().ddi);
    if (!phone) throw new Error('Telefone inválido');
    const r = await B.call('checkNumber', { phone });
    if (!r || !r.id) { const e = new Error('Número sem WhatsApp'); e.invalid = true; throw e; }
    return r.id;
  }

  // Envio de texto único, sempre pela fila e com limite diário.
  E.send = (target, text) =>
    E.queue(async () => {
      if (!licensed()) throw new Error('Licença inativa');
      if (!text) throw new Error('Mensagem vazia');
      if (S.sentToday() >= set().dailyLimit) throw new Error(`Limite diário de ${set().dailyLimit} envios atingido.`);
      const chatId = await resolveChatId(target);
      await B.call('sendText', { chatId, text, typingMs: U.rand(1200, 3000) });
      S.countSent();
      return chatId;
    });

  // Variação de mensagem: alterna entre as opções para não repetir o mesmo texto em massa.
  E.variant = (list, c, rot) => {
    const opts = (list || []).filter(Boolean).slice(0, 4);
    if (!opts.length) return '';
    return opts[(rot == null ? 0 : rot) % opts.length];
  };

  // Aniversariante: compara só dia e mês, com suporte a intervalo que cruza o fim do ano.
  E.birthdayIn = (c, fromMd, toMd) => {
    const n = (c.profile && c.profile.lead && c.profile.lead.nascimento) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n)) return false;
    const md = n.slice(5);
    return fromMd <= toMd ? md >= fromMd && md <= toMd : md >= fromMd || md <= toMd;
  };

  // Dias até o próximo aniversário (0 = hoje).
  E.daysToBirthday = (c) => {
    const n = (c.profile && c.profile.lead && c.profile.lead.nascimento) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n)) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let next = new Date(now.getFullYear(), Number(n.slice(5, 7)) - 1, Number(n.slice(8, 10)));
    if (next < now) next = new Date(now.getFullYear() + 1, Number(n.slice(5, 7)) - 1, Number(n.slice(8, 10)));
    return Math.round((next - now) / 86400e3);
  };

  // ---------- disparos em massa ----------
  // Itens: { id, contactId, phone, name, text, status: 'pending'|'sent'|'failed', err }
  E.enqueueBroadcast = (contactIds, kind, msgs) => {
    const list = S.state.queue;
    let added = 0;
    contactIds.forEach((id) => {
      const c = S.contact(id);
      if (!c) return;
      if (list.some((q) => q.contactId === id && q.status === 'pending')) return;
      const text = E.variant(msgs, c, c.birthdayRot || 0);
      c.birthdayRot = ((c.birthdayRot || 0) + 1) % 4;
      list.push({ id: U.uid(), contactId: id, phone: c.phone, name: c.name, kind, text: U.renderText(text, c), status: 'pending', ts: Date.now() });
      added++;
    });
    S.commit(true);
    return added;
  };

  E.cancelBroadcast = () => {
    S.state.queue.forEach((q) => { if (q.status === 'pending') q.status = 'cancelled'; });
    S.commit(true);
  };

  E.runQueue = async () => {
    if (E.running || !licensed() || !E.ready) return;
    E.running = true;
    let sinceBreak = 0;
    try {
      while (true) {
        const item = S.state.queue.find((q) => q.status === 'pending' && (!q.sendAt || q.sendAt <= Date.now()));
        if (!item) break;
        if (S.sentToday() >= set().dailyLimit) break;
        if (sinceBreak >= set().pauseEvery) {
          await U.sleep(set().pauseMinutes * 60e3);   // pausa longa a cada N envios
          sinceBreak = 0;
        }
        try {
          await E.send({ phone: item.phone, chatId: item.chatId }, item.text);
          item.status = 'sent';
          item.sentAt = Date.now();
          S.addNote(item.contactId, 'Mensagem enviada (' + item.kind + ')', 'auto');
        } catch (e) {
          item.status = 'failed';
          item.err = e.message || String(e);
        }
        S.commit(true);
        sinceBreak++;
        await U.sleep(U.rand(set().minDelaySec, set().maxDelaySec) * 1000);
      }
    } finally {
      E.running = false;
    }
  };

  // ---------- pós-atendimento ----------
  E.dueFollowups = () => {
    const now = Date.now();
    const out = [];
    Object.values(S.state.contacts).forEach((c) => {
      (c.followups || []).forEach((f) => { if (f.status === 'pending' && f.ts <= now) out.push({ c, f }); });
    });
    return out.sort((a, b) => a.f.ts - b.f.ts);
  };

  E.runFollowups = async () => {
    if (!licensed() || !E.ready) return;
    for (const { c, f } of E.dueFollowups()) {
      if (S.sentToday() >= set().dailyLimit) break;
      f.status = 'sending';
      const text = U.renderText(set().followupMsgs[f.step] || set().followupMsgs[0] || '', c);
      try {
        await E.send({ phone: c.phone, chatId: c.chatId }, text);
        f.status = 'done';
        f.doneAt = Date.now();
        S.addNote(c.id, `Pós-atendimento ${f.step + 1} enviado`, 'auto');
      } catch (e) {
        f.status = e.invalid ? 'invalid' : 'failed';
        f.err = e.message || String(e);
      }
      S.commit(true);
      await U.sleep(U.rand(set().minDelaySec, set().maxDelaySec) * 1000);
    }
  };

  // Trava: o relógio roda a cada 20 s, mas os envios podem levar minutos.
  E.tick = async () => {
    if (E.busy || !licensed() || !E.ready) return;
    E.busy = true;
    try {
      if (OA.calendar) await OA.calendar.maybeSync();
      if (OA.backup) OA.backup.maybeRun();
      await E.checkInactivity();
      await E.runFollowups();
      await E.runQueue();
    } finally {
      E.busy = false;
    }
  };

  // Aviso automático ao cliente (iniciar, transferir, finalizar). Não bloqueia a ação se falhar.
  E.notifyClient = async (c, tpl, attName) => {
    if (!set().autoMsgAtendimento || !c || !c.phone) return;
    const text = U.renderText(String(tpl || '').replace(/\{atendente\}/gi, attName || ''), c);
    try { await E.send({ phone: c.phone }, text); }
    catch (e) { S.addNote(c.id, 'Aviso automático não enviado: ' + (e.message || e), 'auto'); S.commit(true); }
  };

  E.onMessage = async (m) => {
    const id = m && m.chatId;
    if (!id) return;
    const c = S.contact(id);
    if (!c) return;
    // Atendente falou: reinicia a contagem de inatividade.
    if (m.fromMe) {
      if (c.attendance && c.attendance.status === 'open') { c.attendance.lastOutAt = Date.now(); c.attendance.warnedAt = 0; }
      return;
    }
    c.lastInbound = Date.now();
  };

  // Inatividade no atendimento: aviso ao cliente e encerramento automático.
  // O relógio conta desde a última mensagem do atendente. Se o cliente responder, a contagem para.
  E.checkInactivity = async () => {
    const s = set();
    const now = Date.now();
    const warnMs = (s.idleWarnMin || 7) * 60e3;
    const closeMs = (s.idleCloseMin || 10) * 60e3;
    for (const c of Object.values(S.state.contacts)) {
      const a = c.attendance;
      if (!a || a.status !== 'open') continue;
      if ((c.lastInbound || 0) > (a.lastOutAt || a.startedAt)) continue; // cliente respondeu
      const idle = now - (a.lastOutAt || a.startedAt);
      if (idle >= closeMs) {
        S.closeAttendance(c.id, { reason: 'Encerrado automaticamente por inatividade', saveProtocol: false });
        S.commit(true);
        continue;
      }
      if (idle >= warnMs && !a.warnedAt) {
        a.warnedAt = now;
        S.commit(true);
        const left = Math.max(1, Math.round((closeMs - idle) / 60e3));
        const tpl = String(s.idleWarnMsg || '').replace(/\{minutos_restantes\}/gi, String(left));
        await E.notifyClient(c, tpl, S.attName(a.attId));
      }
    }
  };

  E.recover = () => {
    // Envios que estavam "em andamento" quando o navegador fechou voltam a ficar pendentes.
    S.state.queue.forEach((q) => { if (q.status === 'sending') q.status = 'pending'; });
    Object.values(S.state.contacts).forEach((c) => (c.followups || []).forEach((f) => { if (f.status === 'sending') f.status = 'pending'; }));
  };
})();
