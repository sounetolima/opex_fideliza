// Opex Fideliza — agenda do Google (somente leitura): lê as próximas 48 h de cada unidade e programa lembretes.
// O token fica no service worker; esta página só pede o token e faz as leituras.
/* global chrome, OA */
(() => {
  'use strict';
  const U = OA.util, S = OA.store;
  const set = () => S.state.settings;
  const C = (OA.calendar = { lastError: '', syncing: false });
  const API = 'https://www.googleapis.com/calendar/v3';
  const WINDOW_MS = 48 * 3600e3;          // lembretes: só agendamentos das próximas 48 h
  const HISTORY_MS = 30 * 86400e3;        // agendamentos dos últimos 30 dias (histórico do cliente)
  const AHEAD_MS = 60 * 86400e3;          // agendamentos dos próximos 60 dias (futuros do cliente)
  const SYNC_EVERY_MS = 15 * 60e3;

  const askToken = (interactive) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'gcal-token', interactive }, (r) => resolve(r || { error: 'Sem resposta do serviço de fundo' }));
  });

  async function api(path, token, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(`${API}${path}${qs ? '?' + qs : ''}`, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) {
      await new Promise((res) => chrome.runtime.sendMessage({ type: 'gcal-revoke' }, res));
      throw new Error('Sessão do Google expirou. Conecte de novo em Agenda.');
    }
    if (!r.ok) throw new Error('Google Agenda respondeu ' + r.status);
    return r.json();
  }

  // Conectar: pede permissão interativa. Lista as agendas para escolher uma por unidade.
  C.connect = async () => {
    const t = await askToken(true);
    if (t.error) throw new Error(t.error);
    const data = await api('/users/me/calendarList', t.token);
    C.calendars = (data.items || []).map((x) => ({ id: x.id, name: x.summary || x.id }));
    set().availableCalendars = C.calendars;
    set().gcalConnected = true;
    S.commit(true);
    return C.calendars;
  };

  // Limpa "faz parse" do HTML da descrição.
  const plain = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

  // Campos esperados na descrição do evento (linhas separadas):
  //   Tel: (79) 99999-9999
  //   Profissional: Dr. Fulano
  C.parseEvent = (ev) => {
    const desc = plain(ev.description);
    const phoneM = desc.match(/tel(?:efone)?\s*:?\s*([+(\d][\d\s().-]{7,})/i);
    const profM = desc.match(/profissional\s*:\s*([^\n]+)/i);
    const svcM = desc.match(/servi[çc]o\s*:\s*([^\n]+)/i);
    const digits = phoneM ? U.digits(phoneM[1]) : '';
    return {
      eventId: ev.id,
      name: String(ev.summary || '').trim() || 'Paciente',
      phone: digits,
      professional: profM ? profM[1].trim() : '',
      service: svcM ? svcM[1].trim() : '',
      optOut: /sem lembrete/i.test(desc),
      start: ev.start && ev.start.dateTime ? new Date(ev.start.dateTime).getTime() : 0,
      status: ev.status,
    };
  };

  // Regra: 1 dia antes para todos; 6 h antes só para turnos vespertinos/noturnos (início a partir do corte).
  C.buildReminders = (evt, unit, now) => {
    const out = [];
    if (!evt.start || evt.status === 'cancelled' || evt.optOut || !evt.phone) return out;
    const cutoff = Number(set().shiftCutoffHour) || 12;
    const startHour = new Date(evt.start).getHours();
    const kinds = [{ kind: '1d', lead: 24 * 3600e3, tpl: set().reminder1dMsg }];
    if (startHour >= cutoff) kinds.push({ kind: '6h', lead: 6 * 3600e3, tpl: set().reminder6hMsg });
    kinds.forEach((k) => {
      const sendAt = evt.start - k.lead;
      // Se o horário do lembrete já passou e a consulta ainda não começou, não envia atrasado.
      if (sendAt < now && evt.start > now) return out.push({ skip: true, kind: k.kind, evt, unit });
      if (evt.start <= now) return;
      out.push({ kind: k.kind, sendAt, evt, unit, tpl: k.tpl });
    });
    return out;
  };

  const fmtHour = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ts) => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });

  // Valor do serviço cadastrado em Ajustes (vazio se não houver).
  const priceOf = (name) => {
    const svc = (set().services || []).find((x) => x.name === name);
    return svc && svc.price ? 'R$ ' + svc.price : '';
  };

  C.render = (tpl, r) => {
    const e = r.evt;
    const txt = String(tpl || '')
      .replace(/\{data\}/gi, fmtDay(e.start))
      .replace(/\{hora\}/gi, fmtHour(e.start))
      .replace(/\{profissional\}/gi, e.professional || 'seu profissional')
      .replace(/\{unidade\}/gi, r.unit.name || '')
      .replace(/\{servico\}/gi, e.service || 'seu atendimento')
      .replace(/\{valor\}/gi, priceOf(e.service))
      .replace(/\{nome\}/gi, e.name || '')
      .replace(/\{telefone\}/gi, U.formatPhone(e.phone || ''));
    return U.renderText(txt, { name: e.name, phone: e.phone });
  };

  // Cria o evento na agenda da unidade escolhida. Precisa da permissão calendar.events.
  C.createEvent = async ({ calId, startMs, durationMin, name, phone, professional, service }) => {
    if (!set().gcalConnected) throw new Error('Conecte a Google Agenda primeiro.');
    const t = await askToken(true);
    if (t.error) throw new Error(t.error);
    const endMs = startMs + (Number(durationMin) || 60) * 60e3;
    const desc = [`Tel: ${phone}`, professional ? `Profissional: ${professional}` : '', `Serviço: ${service}`].filter(Boolean).join('\n');
    const r = await fetch(`${API}/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t.token, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: `${service} — ${name}`,
        description: desc,
        start: { dateTime: new Date(startMs).toISOString() },
        end: { dateTime: new Date(endMs).toISOString() },
      }),
    });
    if (r.status === 401) { await new Promise((res) => chrome.runtime.sendMessage({ type: 'gcal-revoke' }, res)); throw new Error('Sessão do Google expirou. Conecte de novo em Agenda.'); }
    if (!r.ok) throw new Error('Google Agenda não aceitou o evento (' + r.status + ').');
    return r.json();
  };

  // Sincroniza tudo: cria lembretes novos, cancela os que mudaram, mantém o histórico de enviados.
  C.sync = async () => {
    if (C.syncing || !set().gcalConnected || !OA.license.ok) return;
    const cals = set().calendars || [];
    if (!cals.length) return;
    C.syncing = true;
    try {
      const t = await askToken(false);
      if (t.error) throw new Error(t.error);
      const now = Date.now();
      const timeMin = new Date(now - HISTORY_MS).toISOString();
      const timeMax = new Date(now + AHEAD_MS).toISOString();
      const wanted = new Map();
      const appts = [];
      for (const cal of cals) {
        const data = await api(`/calendars/${encodeURIComponent(cal.id)}/events`, t.token, {
          timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
        });
        for (const ev of data.items || []) {
          const evt = C.parseEvent(ev);
          if (!evt.start) continue;
          if (evt.status !== 'cancelled') appts.push({ id: evt.eventId + '|' + evt.start, unit: cal.name, name: evt.name, phone: evt.phone, professional: evt.professional, service: evt.service, start: evt.start });
          if (evt.start - now > WINDOW_MS) continue;
          for (const r of C.buildReminders(evt, cal, now)) {
            if (r.skip) continue;
            const key = `${cal.id}|${evt.eventId}|${evt.start}|${r.kind}`;
            wanted.set(key, { ...r, key });
          }
        }
      }
      // Cancela pendentes de agendas já lidas que sumiram ou mudaram de horário.
      S.state.queue.forEach((q) => {
        if (q.source === 'gcal' && q.status === 'pending' && !wanted.has(q.key)) {
          q.status = 'cancelled'; q.err = 'Evento removido ou alterado';
        }
      });
      // Cria os novos.
      let created = 0;
      wanted.forEach((r) => {
        if (S.state.queue.some((q) => q.key === r.key)) return;
        const phoneId = U.normalizePhone(r.evt.phone, set().ddi) + '@c.us';
        const c = S.upsertContact(phoneId, { name: r.evt.name, phone: r.evt.phone });
        S.addNote(c.id, `Lembrete ${r.kind} programado (${r.unit.name})`, 'auto');
        S.state.queue.push({
          id: U.uid(), key: r.key, source: 'gcal', kind: 'lembrete-' + r.kind,
          contactId: c.id, phone: r.evt.phone, name: r.evt.name, unit: r.unit.name,
          text: C.render(r.tpl, r), sendAt: r.sendAt, status: 'pending', ts: now,
        });
        created++;
      });
      S.state.appointments = appts.sort((a, b) => a.start - b.start);
      // Fila enxuta: itens já resolvidos há mais de 90 dias saem (o histórico do cliente fica nas anotações).
      S.state.queue = S.state.queue.filter((q) => q.status === 'pending' || now - (q.sentAt || q.sendAt || q.ts || now) < 90 * 86400e3);
      set().lastSyncAt = now;
      C.lastError = '';
      S.commit(true);
      return created;
    } catch (e) {
      C.lastError = e.message || String(e);
      S.commit(true);
    } finally {
      C.syncing = false;
    }
  };

  // Chamado pelo relógio: sincroniza a cada 15 min, enquanto a licença estiver ativa.
  C.maybeSync = () => {
    if (!set().gcalConnected) return;
    if (Date.now() - (set().lastSyncAt || 0) < SYNC_EVERY_MS) return;
    C.sync();
  };

  C.disconnect = async () => {
    await new Promise((res) => chrome.runtime.sendMessage({ type: 'gcal-revoke' }, res));
    set().gcalConnected = false;
    set().calendars = [];
    S.commit(true);
  };
})();
