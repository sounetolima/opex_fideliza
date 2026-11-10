// Opex Fideliza — armazenamento local (chrome.storage.local). Nada sai do computador.
/* global chrome, OA */
(() => {
  'use strict';
  const KEY = 'opex_care_v1';
  const U = OA.util;

  const DEFAULT_STAGES = [
    { id: 'novo', name: 'Novo contato', color: '#60A5FA' },
    { id: 'agendado', name: 'Agendado', color: '#3D63DD' },
    { id: 'atendido', name: 'Atendido', color: '#A78BFA' },
    { id: 'orcamento', name: 'Orçamento', color: '#D4AA46' },
    { id: 'fechado', name: 'Fechado', color: '#22C55E' },
    { id: 'inativo', name: 'Inativo', color: '#94A3B8' },
  ];
  const DEFAULT_TAGS = [
    { id: 'vip', name: 'VIP', color: '#D4AA46' },
    { id: 'retorno', name: 'Retorno', color: '#3D63DD' },
    { id: 'convenio', name: 'Convênio', color: '#22C55E' },
    { id: 'urgente', name: 'Urgente', color: '#EF4444' },
  ];

  // Intervalos do pós-atendimento: cada passo é contado a partir do passo anterior.
  const D = 86400e3;
  const FU_OPTIONS = {
    '2h': { label: '2 horas', ms: 2 * 3600e3 }, '1d': { label: '1 dia', ms: D }, '3d': { label: '3 dias', ms: 3 * D },
    '7d': { label: '7 dias', ms: 7 * D }, '15d': { label: '15 dias', ms: 15 * D }, '30d': { label: '30 dias', ms: 30 * D },
    '60d': { label: '60 dias', ms: 60 * D }, '90d': { label: '90 dias', ms: 90 * D }, '180d': { label: '6 meses', ms: 180 * D },
  };

  const defaults = () => ({
    version: 2,
    settings: {
      ddi: '55',
      minDelaySec: 25,
      maxDelaySec: 60,
      dailyLimit: 150,
      pauseEvery: 20,
      pauseMinutes: 5,
      // Até 4 variações: o sistema alterna entre elas para evitar mensagens idênticas em massa.
      birthdayMsgs: [
        '{saudacao}, {primeiro_nome}! 🎂 Desejamos um feliz aniversário, com muita saúde e sorrisos. Conte sempre com a gente!',
        '{saudacao}, {primeiro_nome}! 🎉 Hoje é dia de comemorar. Feliz aniversário! Um abraço da equipe.',
        '{primeiro_nome}, feliz aniversário! 🥳 Que este novo ano traga muitas coisas boas. Obrigado por confiar na gente.',
        '{saudacao}, {primeiro_nome}! 🎈 Parabéns pelo seu dia! Se quiser agendar um cuidado especial, é só responder esta mensagem.',
      ],
      // Pós-atendimento: até 4 mensagens. Cada passo usa um intervalo (2h, 7d ou 15d) a partir do anterior.
      followupMsgs: [
        '{saudacao}, {primeiro_nome}! Tudo bem por aí? Passando para saber como você está após o atendimento. 😊',
        '{primeiro_nome}, tudo certo com você? Se sentir qualquer coisa diferente, é só me avisar por aqui.',
        '{saudacao}, {primeiro_nome}! Lembrando que estamos à disposição. Gostaria de agendar um retorno?',
        '{primeiro_nome}, passando uma última vez para saber como você está. Obrigado pela confiança! 🙏',
      ],
      followupSteps: ['2h', '7d', '15d'],
      currentAttendant: '',
      autoMsgAtendimento: true,   // avisa o cliente quando inicia, transfere ou encerra
      msgIniciar: '{saudacao}, {primeiro_nome}! {atendente} iniciou o seu atendimento. 😊',
      msgTransferir: '{primeiro_nome}, agora quem cuida do seu atendimento é {atendente}.',
      msgFinalizar: '{primeiro_nome}, seu atendimento foi finalizado. Obrigado pela confiança! 🙏',
      lastBackupAt: 0,
      backupOn: false,
      backupFileId: '',
      gcalConnected: false,
      availableCalendars: [], // agendas encontradas na conta do Google
      calendars: [],          // uma agenda do Google por unidade: { id, name }
      lastSyncAt: 0,
      services: [],           // serviços: { name, price, minutes } — escolhidos na agenda e citados nos lembretes
      idleWarnMin: 7,         // aviso ao cliente sem resposta (minutos desde a última mensagem do atendente)
      idleCloseMin: 10,       // encerramento automático sem resposta do cliente
      idleWarnMsg: '{primeiro_nome}, seu atendimento poderá ser encerrado automaticamente em {minutos_restantes} minutos por inatividade. Se precisar de algo, é só responder.',
      shiftCutoffHour: 12,    // início a partir deste horário = turno vespertino/noturno (recebe lembrete 6 h antes)
      confirmOnBooking: true, // ao marcar pelo painel, envia a confirmação com os dados
      confirmMsg: '{saudacao}, {primeiro_nome}! Seu horário está marcado: {servico} em {data} às {hora}, na {unidade}. Qualquer imprevisto, é só avisar por aqui. 😊',
      reminder1dMsg: '{saudacao}, {primeiro_nome}! Lembrete: amanhã ({data}) às {hora} você tem {servico} na {unidade}. Estamos aguardando a sua presença! 😊',
      reminder6hMsg: '{saudacao}, {primeiro_nome}! Hoje às {hora} você tem {servico} na {unidade}. Estamos aguardando a sua presença! 👋',
      panelOpen: true,
      blur: false,
    },
    stages: DEFAULT_STAGES,
    tags: DEFAULT_TAGS,
    contacts: {},
    attendants: [],
    queue: [],        // disparos em massa aguardando envio
    atendimentos: [], // encerramentos: { id, protocol, contactId, name, attId, startedAt, endedAt, minutes, reason, saved }
    protocolSeq: { date: '', n: 0 },
    stats: { date: '', sent: 0 },
    followupOptions: FU_OPTIONS,
  });

  const listeners = new Set();
  let state = defaults();
  let saveTimer = null;
  let lastWrite = 0;

  function merge(base, saved) {
    const out = Object.assign(base, saved || {});
    out.settings = Object.assign(defaults().settings, (saved && saved.settings) || {});
    if (!Array.isArray(out.stages) || !out.stages.length) out.stages = DEFAULT_STAGES;
    ['tags', 'attendants', 'queue', 'appointments'].forEach((k) => { if (!Array.isArray(out[k])) out[k] = []; });
    if (!out.contacts || typeof out.contacts !== 'object') out.contacts = {};
    out.followupOptions = FU_OPTIONS;
    return out;
  }

  const S = (OA.store = {
    get state() { return state; },
    FU_OPTIONS,

    async load() {
      const got = await chrome.storage.local.get(KEY);
      state = merge(defaults(), got[KEY]);
      return state;
    },

    save(immediate = false) {
      clearTimeout(saveTimer);
      const write = () => {
        lastWrite = Date.now();
        return chrome.storage.local.set({ [KEY]: state }).catch((e) => console.error('[Opex Fideliza] save', e));
      };
      if (immediate) return write();
      saveTimer = setTimeout(write, 250);
      return Promise.resolve();
    },

    commit(immediate = false) {
      S.save(immediate);
      listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    replaceAll(data) { state = merge(defaults(), data); S.commit(true); },
    reset() { state = defaults(); S.commit(true); },

    // ---------- contatos ----------
    contact(id) { return state.contacts[id] || null; },

    upsertContact(id, patch = {}) {
      if (!id) return null;
      let c = state.contacts[id];
      const now = Date.now();
      if (!c) {
        c = state.contacts[id] = {
          id, name: '', phone: '', stageId: state.stages[0].id, tags: [], profile: {},
          notes: [], history: [], followups: [], attendance: null, birthdayRot: 0,
          createdAt: now, updatedAt: now, lastInbound: 0,
        };
        c.notes.push({ ts: now, type: 'auto', text: 'Contato criado' });
      }
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if ((k === 'name' || k === 'phone') && !v) continue;
        c[k] = v;
      }
      c.updatedAt = now;
      return c;
    },

    addNote(id, text, type = 'note') {
      const c = S.upsertContact(id);
      if (!c || !text) return;
      c.notes.unshift({ ts: Date.now(), type, text: String(text).slice(0, 2000) });
      if (c.notes.length > 200) c.notes.length = 200;
    },

    // Histórico: visitas, vendas e atendimentos realizados.
    addHistory(id, { type, text = '', value = 0, attId = '' }) {
      const c = S.upsertContact(id);
      if (!c) return;
      c.history.unshift({ id: U.uid(), ts: Date.now(), type, text: String(text).slice(0, 1000), value: Number(value) || 0, attId });
      if (c.history.length > 500) c.history.length = 500;
    },

    setStage(id, stageId) {
      const c = S.upsertContact(id);
      if (!c || c.stageId === stageId) return;
      const st = state.stages.find((s) => s.id === stageId);
      c.stageId = stageId;
      S.addNote(id, 'Movido para ' + (st ? st.name : stageId), 'auto');
    },

    toggleTag(id, tagId) {
      const c = S.upsertContact(id);
      const i = c.tags.indexOf(tagId);
      const tag = state.tags.find((t) => t.id === tagId);
      if (i >= 0) { c.tags.splice(i, 1); S.addNote(id, 'Etiqueta removida: ' + (tag ? tag.name : tagId), 'auto'); }
      else { c.tags.push(tagId); S.addNote(id, 'Etiqueta: ' + (tag ? tag.name : tagId), 'auto'); }
    },

    attendant(id) { return state.attendants.find((a) => a.id === id) || null; },
    attName(id) { const a = S.attendant(id); return a ? a.name : 'Sem atendente'; },

    startAttendance(id, attId) {
      const c = S.upsertContact(id);
      if (c.attendance && c.attendance.status === 'open') return false;
      c.attendance = { status: 'open', attId, startedAt: Date.now(), lastOutAt: Date.now(), warnedAt: 0 };
      S.addNote(id, 'Atendimento iniciado por ' + S.attName(attId), 'auto');
      return true;
    },

    // Finaliza o atendimento registrando o que foi feito e, se pedido, programa o pós-atendimento.
    finishAttendance(id, { attId, kind = 'atendimento', text = '', value = 0, followup = false }) {
      const c = S.contact(id);
      if (!c) return false;
      const start = c.attendance && c.attendance.status === 'open' ? c.attendance.startedAt : null;
      if (c.attendance) c.attendance = null;
      S.addHistory(id, { type: kind, text, value, attId });
      const mins = start ? Math.max(1, Math.round((Date.now() - start) / 60000)) : 0;
      S.addNote(id, `Atendimento finalizado por ${S.attName(attId)} — ${kind}${mins ? ` (${mins} min)` : ''}${text ? ': ' + text : ''}`, 'auto');
      if (followup) S.scheduleFollowups(id, Date.now());
      return true;
    },

    // Cria os retornos programados (até 4) a partir do momento informado.
    scheduleFollowups(id, fromTs) {
      const c = S.upsertContact(id);
      const steps = (state.settings.followupSteps || []).slice(0, 4);
      // Um ciclo por vez: o novo atendimento substitui os retornos que ainda não saíram.
      c.followups.forEach((f) => { if (f.status === 'pending') f.status = 'skipped'; });
      let t = fromTs;
      steps.forEach((k, i) => {
        const opt = FU_OPTIONS[k];
        if (!opt) return;
        t += opt.ms;
        c.followups.push({ id: U.uid(), ts: t, step: i, status: 'pending', createdAt: Date.now() });
      });
      c.followups.sort((a, b) => a.ts - b.ts);
      S.addNote(id, `Pós-atendimento programado: ${steps.length} retorno(s)`, 'auto');
    },

    cancelFollowups(id) {
      const c = S.contact(id);
      if (!c) return;
      c.followups.forEach((f) => { if (f.status === 'pending') f.status = 'skipped'; });
    },

    deleteContact(id) { delete state.contacts[id]; },

    // Protocolo sequencial por dia: PU-AAAAMMDD-001.
    nextProtocol() {
      const now = new Date();
      const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      if (state.protocolSeq.date !== day) state.protocolSeq = { date: day, n: 0 };
      state.protocolSeq.n++;
      return `PU-${day}-${String(state.protocolSeq.n).padStart(3, '0')}`;
    },

    // Transferência: troca o atendente que está com a conversa.
    transferAttendance(id, attId) {
      const c = S.contact(id);
      if (!c || !c.attendance || c.attendance.status !== 'open') return false;
      const from = S.attName(c.attendance.attId);
      c.attendance.attId = attId;
      S.addNote(id, `Atendimento transferido de ${from} para ${S.attName(attId)}`, 'auto');
      return true;
    },

    // Encerramento: registra quem finalizou, duração e motivo; com protocolo, grava em "Atendimentos salvos".
    closeAttendance(id, { reason = '', saveProtocol = false }) {
      const c = S.contact(id);
      if (!c || !c.attendance || c.attendance.status !== 'open') return null;
      const endedAt = Date.now();
      const minutes = Math.max(1, Math.round((endedAt - c.attendance.startedAt) / 60000));
      const rec = {
        id: U.uid(), protocol: saveProtocol ? S.nextProtocol() : '', contactId: id, name: c.name || U.formatPhone(c.phone),
        attId: c.attendance.attId, startedAt: c.attendance.startedAt, endedAt, minutes, reason: String(reason || '').slice(0, 300), saved: !!saveProtocol,
      };
      state.atendimentos.unshift(rec);
      if (state.atendimentos.length > 2000) state.atendimentos.length = 2000;
      c.attendance = null;
      S.addHistory(id, { type: 'atendimento', text: rec.reason || 'Atendimento finalizado', attId: rec.attId });
      S.addNote(id, `Atendimento finalizado por ${S.attName(rec.attId)} em ${minutes} min${rec.reason ? ': ' + rec.reason : ''}${rec.protocol ? ' · protocolo ' + rec.protocol : ''}`, 'auto');
      return rec;
    },

    // Relatório por atendente: abertos agora, finalizados hoje e tempo médio.
    report() {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const t0 = today.getTime();
      return state.attendants.map((a) => {
        const open = Object.values(state.contacts).filter((c) => c.attendance && c.attendance.status === 'open' && c.attendance.attId === a.id).length;
        const done = state.atendimentos.filter((r) => r.attId === a.id);
        const today_ = done.filter((r) => r.endedAt >= t0);
        const avg = done.length ? Math.round(done.reduce((s, r) => s + r.minutes, 0) / done.length) : 0;
        return { id: a.id, name: a.name, open, doneToday: today_.length, avgMinutes: avg };
      });
    },

    stage(id) { return state.stages.find((s) => s.id === id) || state.stages[0]; },
    tag(id) { return state.tags.find((t) => t.id === id); },

    // ---------- contadores ----------
    countSent() {
      const d = U.today();
      if (state.stats.date !== d) state.stats = { date: d, sent: 0 };
      state.stats.sent++;
    },
    sentToday() { return state.stats.date === U.today() ? state.stats.sent : 0; },
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY] || Date.now() - lastWrite < 1500) return;
    const nv = changes[KEY].newValue;
    if (nv) { state = merge(defaults(), nv); listeners.forEach((fn) => fn(state)); }
  });
})();
