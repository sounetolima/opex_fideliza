// Opex Fideliza — interface enxuta: painel lateral dentro de Shadow DOM.
/* global chrome, OA */
(() => {
  'use strict';
  const U = OA.util, S = OA.store, E = OA.engine, B = OA.bridge;
  const esc = U.esc;
  const st = () => S.state;
  const set = () => st().settings;

  const ui = (OA.ui = { tab: 'hoje', activeId: null, ready: false, bdFrom: '', bdTo: '', bdPreset: 'hoje', bdSel: new Set(), lockMsg: '', clQuery: '', clOpen: null });

  let shadow, drawer, body, launcher, renderQueued = false;

  const TABS = [['hoje', 'Hoje'], ['atend', 'Atendimento'], ['agenda', 'Agenda'], ['aniv', 'Aniversariantes'], ['clientes', 'Clientes'], ['funil', 'Funil'], ['cliente', 'Cliente'], ['ajustes', 'Ajustes']];
  const color = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#3D63DD');
  const cname = (c) => (c && (c.name || U.formatPhone(c.phone))) || 'Sem nome';
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtDM = (s) => (s && s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
  const pad = (n) => String(n).padStart(2, '0');
  const md = (d) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const TYPE_LABEL = { visita: 'Visita', venda: 'Venda', atendimento: 'Atendimento' };
  const FU_STATUS = { pending: ['Pendente', 'gold'], done: ['Enviado', 'ok'], skipped: ['Cancelado', ''], failed: ['Falhou', 'bad'], invalid: ['Sem WhatsApp', 'bad'] };

  // ---------- ícones ----------
  const ic = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICON = {
    clientes: ic('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.5"/>'),
    hoje: ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    atend: ic('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    agenda: ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    aniv: ic('<path d="M20 21V11a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10"/><path d="M4 16c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1M12 8V5M10 5h4"/>'),
    funil: ic('<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>'),
    cliente: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
    ajustes: ic('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  };

  // ---------- helpers de template ----------
  const stageChip = (s, on) => `<button class="chip ${on ? 'on' : ''}" style="--c:${color(s.color)}" data-a="stage" data-id="${esc(s.id)}"><i style="background:${color(s.color)}"></i>${esc(s.name)}</button>`;
  const tagChip = (t, on) => `<button class="chip ${on ? 'on' : ''}" style="--c:${color(t.color)}" data-a="tag" data-id="${esc(t.id)}"><i style="background:${color(t.color)}"></i>${esc(t.name)}</button>`;
  const attOptions = (sel) => '<option value="">Selecione…</option>' + st().attendants.map((a) => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const stepOptions = (sel) => Object.entries(S.FU_OPTIONS).map(([k, o]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${o.label}</option>`).join('');
  // Etiquetas de variáveis: tocar copia o texto para colar na mensagem.
  const REMINDER_VARS = ['nome', 'primeiro_nome', 'saudacao', 'telefone', 'servico', 'valor', 'data', 'hora', 'profissional', 'unidade'];
  const MSG_VARS = ['nome', 'primeiro_nome', 'saudacao', 'telefone'];
  const chipsHint = (keys, extra = '') => `<div class="chips">${keys.map((k) => `<button class="chip" data-a="copy-var" data-v="{${k}}">{${k}}</button>`).join('')}</div><div class="muted small">Toque numa variável para copiar e colar na mensagem.${extra}</div>`;
  const varsHint = chipsHint(MSG_VARS, ' Variações: {Oi|Olá|E aí}');

  function activeContact() { return ui.activeId ? S.contact(ui.activeId) : null; }

  // ---------- painel: cartões de cada aba ----------
  function lockCard() {
    return `<div class="card"><b>Ative sua licença</b>
      <div class="muted small">${esc(OA.license.message || 'Entre com seu e-mail ou telefone e a senha, ou digite a chave.')}</div>
      <label class="f">E-mail ou telefone</label><input class="in" id="lk-login" autocomplete="username">
      <label class="f">Senha</label><input class="in" id="lk-pass" type="password" autocomplete="current-password">
      <div class="row"><button class="btn primary block" data-a="lk-login">Entrar</button></div>
      <label class="f">Ou chave de licença</label><input class="in" id="lk-key" placeholder="XXXX-XXXX-XXXX">
      <div class="row"><button class="btn gold block" data-a="lk-key">Ativar com chave</button></div>
    </div>`;
  }

  function hojeTab() {
    const due = E.dueFollowups();
    const upcoming = [];
    Object.values(st().contacts).forEach((c) => (c.followups || []).forEach((f) => { if (f.status === 'pending' && f.ts > Date.now()) upcoming.push({ c, f }); }));
    upcoming.sort((a, b) => a.f.ts - b.f.ts);
    const row = ({ c, f }) => `<div class="item"><div class="top"><span class="ttl">${esc(cname(c))}</span><span class="pill blue">Retorno ${f.step + 1}</span></div>
      <div class="muted small">${fmtDate(f.ts)} · ${U.relTime(f.ts)}</div>
      <div class="row"><button class="link" data-a="open" data-id="${esc(c.id)}">Abrir</button>
      <button class="link" data-a="fu-now" data-id="${esc(c.id)}" data-f="${esc(f.id)}">Enviar agora</button>
      <button class="link" data-a="fu-cancel" data-id="${esc(c.id)}" data-f="${esc(f.id)}">Cancelar</button></div></div>`;
    const counts = `<div class="kpis"><div><b>${due.length}</b><span>Retornos vencidos</span></div><div><b>${upcoming.length}</b><span>Programados</span></div><div><b>${S.sentToday()}</b><span>Envios hoje</span></div></div>`;
    return `${counts}
      <div class="card"><b>Retornos vencidos</b>${due.length ? due.map(row).join('') : '<div class="muted small">Nenhum retorno vencido.</div>'}</div>
      <div class="card"><b>Próximos retornos</b>${upcoming.length ? upcoming.slice(0, 30).map(row).join('') : '<div class="muted small">Nada programado.</div>'}</div>`;
  }

  function periodRange() {
    const today = new Date();
    if (ui.bdPreset === 'hoje') return [md(today), md(today)];
    if (ui.bdPreset === '7') { const e = new Date(today); e.setDate(e.getDate() + 6); return [md(today), md(e)]; }
    if (ui.bdPreset === '30') { const e = new Date(today); e.setDate(e.getDate() + 29); return [md(today), md(e)]; }
    if (ui.bdPreset === 'mes') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return [md(first), md(last)];
    }
    // personalizado: datas em formato AAAA-MM-DD, usamos só mês e dia
    return [ui.bdFrom ? ui.bdFrom.slice(5) : md(today), ui.bdTo ? ui.bdTo.slice(5) : md(today)];
  }

  function anivTab() {
    const [from, to] = periodRange();
    const list = Object.values(st().contacts)
      .filter((c) => E.birthdayIn(c, from, to))
      .sort((a, b) => E.daysToBirthday(a) - E.daysToBirthday(b));
    const pending = st().queue.filter((q) => q.status === 'pending').length;
    const presets = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['custom', 'Período']];
    const msgs = set().birthdayMsgs.filter(Boolean);
    const sel = ui.bdSel;
    const rows = list.map((c) => `<label class="irow">
        <input type="checkbox" data-a="bd-toggle" data-id="${esc(c.id)}" ${sel.has(c.id) ? 'checked' : ''}>
        <div class="itx"><b>${esc(cname(c))}</b><small>${fmtDM(c.profile.lead.nascimento)} · ${E.daysToBirthday(c) === 0 ? 'hoje' : 'em ' + E.daysToBirthday(c) + ' dia(s)'}</small></div>
      </label>`).join('');
    const queueList = st().queue.slice(-12).reverse().map((q) => `<div class="item"><div class="top"><span class="ttl">${esc(q.name || q.phone)}</span>
      <span class="pill ${q.status === 'sent' ? 'ok' : q.status === 'failed' ? 'bad' : 'gold'}">${({ pending: 'Na fila', sent: 'Enviado', failed: 'Falhou', cancelled: 'Cancelado' })[q.status] || q.status}</span></div>
      ${q.err ? `<div class="muted small">${esc(q.err)}</div>` : ''}</div>`).join('');
    return `<div class="card"><b>Período</b>
        <div class="row">${presets.map(([k, l]) => `<button class="chip ${ui.bdPreset === k ? 'on' : ''}" data-a="bd-preset" data-k="${k}">${l}</button>`).join('')}</div>
        ${ui.bdPreset === 'custom' ? `<div class="row"><input type="date" class="in" data-a="bd-from" value="${esc(ui.bdFrom)}"><input type="date" class="in" data-a="bd-to" value="${esc(ui.bdTo)}"></div>` : ''}
        <div class="muted small">Mostrando ${list.length} aniversariante(s). Só o dia e o mês do cadastro são considerados.</div>
      </div>
      <div class="card"><div class="row"><b>Aniversariantes</b><button class="link" data-a="bd-all">Selecionar todos</button></div>
        ${rows || '<div class="muted small">Nenhum aniversariante neste período. Preencha a data de nascimento na aba Cliente.</div>'}
      </div>
      <div class="card"><b>Mensagens (${msgs.length} variação(ões))</b>
        <div class="muted small">O sistema alterna entre as variações para não enviar a mesma mensagem a todos. Máximo de 4 — ajuste em Ajustes.</div>
        <div class="row"><button class="btn primary block" data-a="bd-send" ${sel.size && msgs.length ? '' : 'disabled'}>Enviar para ${sel.size} selecionado(s)</button></div>
        <div class="muted small">Envios com intervalo de ${set().minDelaySec}–${set().maxDelaySec} s, pausa de ${set().pauseMinutes} min a cada ${set().pauseEvery} envios e limite de ${set().dailyLimit} por dia. Revise antes de enviar.</div>
        ${pending ? `<div class="row"><span class="pill gold">${pending} na fila</span><button class="link" data-a="bd-cancel">Cancelar fila</button></div>` : ''}
      </div>
      ${queueList ? `<div class="card"><b>Últimos envios</b>${queueList}</div>` : ''}`;
  }

  // ---------- Clientes: busca, cartão expansível, histórico PU e agendamentos ----------
  const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
  const sameFone = (a, b) => a && b && onlyDigits(a).slice(-8) === onlyDigits(b).slice(-8);
  const fmtDT = (ts) => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function clientesFiltered() {
    const q = (ui.clQuery || '').trim().toLowerCase();
    const dq = onlyDigits(q);
    return Object.values(st().contacts)
      .filter((c) => {
        if (!q) return true;
        const hay = (cname(c) + ' ' + (c.phone || '')).toLowerCase();
        return hay.includes(q) || (dq.length >= 4 && onlyDigits(c.phone).includes(dq));
      })
      .sort((a, b) => cname(a).localeCompare(cname(b), 'pt-BR'));
  }

  // Retornos do pós-atendimento do cliente. Com edição, a data de cada retorno pendente pode ser trocada.
  const isoDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  function fuRows(c, editable) {
    return (c.followups || []).filter((f) => f.status !== 'skipped').slice(-8).map((f) => {
      const [lbl, cls] = FU_STATUS[f.status] || [f.status, ''];
      const msg = set().followupMsgs[f.step] || set().followupMsgs[0] || '';
      return `<div class="irow"><div class="itx"><b>Retorno ${f.step + 1}</b><small>${fmtDT(f.ts)}</small><small>${esc(msg.slice(0, 70))}${msg.length > 70 ? '…' : ''}</small></div><span class="pill ${cls}">${lbl}</span>
        ${editable && f.status === 'pending' ? `<input class="in" type="date" style="max-width:140px" data-a="fu-date" data-id="${esc(c.id)}" data-f="${esc(f.id)}" value="${isoDay(f.ts)}"><button class="link" data-a="fu-now" data-id="${esc(c.id)}" data-f="${esc(f.id)}">Enviar</button><button class="link" data-a="fu-cancel" data-id="${esc(c.id)}" data-f="${esc(f.id)}">Cancelar</button>` : ''}</div>`;
    }).join('');
  }

  function clienteDetalhe(c) {
    const now = Date.now();
    const lead = (c.profile && c.profile.lead) || {};
    const extra = Object.entries(lead).filter(([k, v]) => v && k !== 'nascimento')
      .map(([k, v]) => `<div class="muted small"><b>${esc(k)}:</b> ${esc(String(v))}</div>`).join('');
    const appts = (st().appointments || []).filter((a) => sameFone(a.phone, c.phone));
    const futuros = appts.filter((a) => a.start >= now);
    const passados = appts.filter((a) => a.start < now).reverse();
    const linha = (a) => `<div class="irow"><div class="itx"><b>${esc(a.service || 'Atendimento')}</b><small>${fmtDT(a.start)} · ${esc(a.unit || '')}${a.professional ? ' · ' + esc(a.professional) : ''}</small></div></div>`;
    const pu = (st().atendimentos || []).filter((r) => r.contactId === c.id).slice(0, 30)
      .map((r) => `<li><div class="t">${esc(r.protocol || '')} · ${fmtDT(r.startedAt || r.ts || now)}</div><div class="muted small">${r.minutes != null ? r.minutes + ' min · ' : ''}${esc(S.attName(r.attId))}${r.reason ? ' · ' + esc(r.reason) : ''}</div></li>`).join('');
    const hist = (c.history || []).slice(0, 30).map((h) => `<li><div class="t">${fmtDate(h.ts)} · ${esc(TYPE_LABEL[h.type] || h.type)}${h.value ? ' · ' + U.money(h.value) : ''}</div><div>${esc(h.text || '')}</div></li>`).join('');
    const lembs = (st().queue || []).filter((q) => q.contactId === c.id && q.source === 'gcal').slice(-10).reverse()
      .map((q) => `<div class="irow"><div class="itx"><b>${q.kind === 'lembrete-1d' ? 'Lembrete 1 dia antes' : 'Lembrete 6 h antes'}</b><small>${fmtDT(q.sendAt)}</small></div><span class="pill ${q.status === 'sent' ? 'ok' : 'blue'}">${q.status === 'sent' ? 'Enviado' : q.status === 'pending' ? 'Programado' : esc(q.status)}</span></div>`).join('');
    return `
      <div class="muted small">${U.formatPhone(c.phone)} · ${c.tags.map((t) => S.tag(t) ? esc(S.tag(t).name) : '').filter(Boolean).join(', ') || 'sem etiquetas'}</div>
      ${lead.nascimento ? `<div class="muted small"><b>Nascimento:</b> ${fmtDM(lead.nascimento)} · ${E.daysToBirthday(c) === 0 ? 'hoje' : 'em ' + E.daysToBirthday(c) + ' dia(s)'}</div>` : '<div class="muted small">Sem data de nascimento</div>'}
      ${extra}
      <b class="sec">Próximos agendamentos (${futuros.length})</b>${futuros.map(linha).join('') || '<div class="muted small">Nenhum agendado.</div>'}
      <b class="sec">Lembretes</b>${lembs || '<div class="muted small">Nenhum lembrete programado.</div>'}
      <b class="sec">Pós-atendimento</b>${fuRows(c, false) || '<div class="muted small">Nenhum retorno programado.</div>'}
      <b class="sec">Agendamentos passados (${passados.length})</b>${passados.map(linha).join('') || '<div class="muted small">Nenhum nos últimos 30 dias.</div>'}
      <b class="sec">Histórico PU salvo (${(st().atendimentos || []).filter((r) => r.contactId === c.id).length})</b>
      ${pu ? `<ul class="hist">${pu}</ul>` : '<div class="muted small">Nenhum atendimento salvo.</div>'}
      ${hist ? `<b class="sec">Histórico de visitas e vendas</b><ul class="hist">${hist}</ul>` : ''}
      <div class="row"><button class="btn primary block" data-a="open" data-id="${esc(c.id)}">Abrir ficha</button></div>`;
  }

  function clientesList() {
    const list = clientesFiltered();
    if (!list.length) return '<div class="muted small">Nenhum cliente encontrado.</div>';
    return list.map((c) => {
      const open = ui.clOpen === c.id;
      const stage = st().stages.find((s) => s.id === c.stageId);
      return `<div class="kcard cl-card" style="margin-bottom:8px">
        <div class="row" data-a="cl-toggle" data-id="${esc(c.id)}" style="justify-content:space-between;cursor:pointer">
          <div><div class="ttl">${esc(cname(c))}</div><div class="muted small">${U.formatPhone(c.phone)}</div></div>
          <span class="pill">${stage ? esc(stage.name) : ''}</span>
        </div>
        ${open ? clienteDetalhe(c) : ''}
      </div>`;
    }).join('');
  }

  // Agenda do dia: compromissos de hoje vindos da Google Agenda, em ordem de horário.
  function agendaHoje() {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const t1 = t0.getTime() + 864e5;
    const hoje = (st().appointments || []).filter((a) => a.start >= t0.getTime() && a.start < t1).sort((a, b) => a.start - b.start);
    const hora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `<div class="card"><b>Agenda de hoje (${hoje.length})</b>
      ${hoje.map((a) => `<div class="irow"><div class="itx"><b>${hora(a.start)} · ${esc(a.name || 'Cliente')}</b><small>${esc(a.service || 'Atendimento')}${a.unit ? ' · ' + esc(a.unit) : ''}${a.professional ? ' · ' + esc(a.professional) : ''}</small></div></div>`).join('') || '<div class="muted small">Nada agendado para hoje.</div>'}
    </div>`;
  }

  function clientesTab() {
    return `${agendaHoje()}<div class="card"><b>Clientes</b><div class="muted small">Busque por nome ou telefone. Toque no cliente para ver agendamentos, lembretes e o histórico PU.</div>
      <input class="in" id="cl-q" placeholder="Nome ou telefone" value="${esc(ui.clQuery || '')}" style="margin-top:8px">
      <div id="cl-list" style="margin-top:10px">${clientesList()}</div></div>`;
  }

  // Ao digitar, atualiza só a lista (o campo de busca mantém o foco).
  function refreshClientesList() {
    const el = shadow.getElementById('cl-list');
    if (el) el.innerHTML = clientesList();
  }

  function funilTab() {
    const cols = st().stages.map((s) => {
      const items = Object.values(st().contacts).filter((c) => c.stageId === s.id);
      return `<div class="col"><div class="col-head" style="--c:${color(s.color)}"><b>${esc(s.name)}</b><span class="pill">${items.length}</span></div>
        ${items.map((c) => `<div class="kcard" data-a="open" data-id="${esc(c.id)}"><div class="ttl">${esc(cname(c))}</div>
          <div class="muted small">${U.formatPhone(c.phone)}</div>
          <div class="row">${c.tags.map((t) => S.tag(t) ? `<span class="pill" style="color:${color(S.tag(t).color)}">${esc(S.tag(t).name)}</span>` : '').join('')}</div></div>`).join('') || '<div class="muted small">—</div>'}
      </div>`;
    });
    return `<div class="cols">${cols.join('')}</div>`;
  }

  // ---------- consultas do cliente (status por atendimento) ----------
  const hm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  // Guarda o que está digitado no formulário de agendamento, para não perder ao redesenhar a tela.
  function saveBk() {
    const g = (id) => { const e = shadow.getElementById(id); return e ? e.value.trim() : ''; };
    ui.bk = { ...(ui.bk || {}), cal: g('bk-cal'), date: g('bk-date'), svc: g('bk-svc'), name: g('bk-name'), phone: g('bk-phone'), prof: g('bk-prof') };
    return ui.bk;
  }
  const APPT_STATUS = ['Agendada', 'Confirmada', 'Paciente aguardando', 'Paciente em atendimento', 'Finalizada', 'Faltou', 'Cancelada pelo paciente', 'Cancelada pelo dentista'];
  const apptStatus = (a, now) => a.localStatus || (a.status === 'cancelled' ? 'Cancelada' : a.start < now ? 'Finalizada' : 'Agendada');
  const apptTone = (s) => (/Cancelada|Faltou/.test(s) ? 'bad' : /Confirmada|Finalizada|em atendimento/.test(s) ? 'ok' : /aguardando/.test(s) ? 'gold' : 'blue');
  function consultasCard(c) {
    const now = Date.now();
    const list = (st().appointments || []).filter((a) => sameFone(a.phone, c.phone)).sort((a, b) => b.start - a.start).slice(0, 8);
    const rows = list.map((a) => {
      const s = apptStatus(a, now);
      return `<div class="irow"><div class="itx"><b>${esc(a.service || 'Atendimento')}</b><small>${fmtDT(a.start)}${a.professional ? ' · ' + esc(a.professional) : ''}</small></div>
        <select class="in" style="width:auto" data-a="appt-status" data-id="${esc(a.id)}">${APPT_STATUS.map((o) => `<option ${o === s ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <span class="pill ${apptTone(s)}">${esc(s)}</span></div>`;
    }).join('');
    const btn = c.phone ? `<div class="row"><button class="btn primary block" data-a="appt-new" data-id="${esc(c.id)}">Agendar nova consulta</button></div>` : '';
    return `<div class="card"><b>Consultas</b>${btn}${rows || '<div class="muted small">Nenhuma consulta encontrada para este cliente.</div>'}</div>`;
  }

  function clienteTab() {
    const c = activeContact();
    if (!c) return '<div class="card"><b>Nenhum cliente selecionado</b><div class="muted small">Abra uma conversa no WhatsApp Web ou escolha um cliente no Funil.</div></div>';
    const lead = (c.profile && c.profile.lead) || {};
    const att = c.attendance && c.attendance.status === 'open' ? c.attendance : null;
    const hist = (c.history || []).slice(0, 60).map((h) => `<li class="${h.type === 'atendimento' ? '' : 'auto'}"><div class="t">${fmtDate(h.ts)} · ${esc(TYPE_LABEL[h.type] || h.type)}${h.value ? ' · ' + U.money(h.value) : ''}</div>
      <div>${esc(h.text || '')}</div><div class="muted small">${esc(S.attName(h.attId))}</div></li>`).join('');
    const fus = fuRows(c, true);
    const ciclo = (set().followupSteps || []).map((k) => (S.FU_OPTIONS[k] || {}).label).filter(Boolean).join(' → ') || 'nenhum retorno configurado';
    const notes = (c.notes || []).slice(0, 30).map((n) => `<li class="${n.type === 'auto' ? 'auto' : ''}"><div class="t">${fmtDate(n.ts)}</div><div>${esc(n.text)}</div></li>`).join('');
    return `
      <div class="card"><div class="who"><div class="avatar">${esc(cname(c).slice(0, 2).toUpperCase())}</div><div>
        <div class="name">${esc(cname(c))}</div><div class="muted small">${U.formatPhone(c.phone)}</div></div></div>
        <label class="f">Nome</label><input class="in" data-cset="name" value="${esc(c.name)}">
        <label class="f">Nascimento</label><input class="in" type="date" data-lset="nascimento" value="${esc(lead.nascimento || '')}">
        <label class="f">Atendente</label><select class="in" data-cset="attId">${attOptions(c.attendance ? c.attendance.attId : set().currentAttendant)}</select>
      </div>
      ${consultasCard(c)}
      <div class="card"><b>Etapa</b><div class="row wrap">${st().stages.map((s) => stageChip(s, c.stageId === s.id)).join('')}</div>
        <b>Etiquetas</b><div class="row wrap">${st().tags.map((t) => tagChip(t, c.tags.includes(t.id))).join('')}</div></div>
      <div class="card"><b>Atendimento</b>
        ${att ? `<div class="muted small">Em atendimento desde ${fmtDate(att.startedAt)} · com ${esc(S.attName(att.attId))}</div>
          <label class="f">Transferir para</label><div class="row"><select class="in" id="tr-att">${attOptions(att.attId)}</select><button class="btn ghost" data-a="att-transfer">Transferir</button></div>
          <label class="f">Motivo / resumo (opcional)</label><textarea class="in" id="fz-text" rows="2"></textarea>
          <label class="toggle"><span>Programar pós-atendimento (${esc(ciclo)})</span><span class="switch"><input type="checkbox" id="fz-fu" checked><span></span></span></label>
          <div class="row"><button class="btn gold block" data-a="att-close">Finalizar</button><button class="btn primary block" data-a="att-close-save">Finalizar e salvar protocolo</button></div>`
        : `<label class="f">Atendente</label><select class="in" id="st-att">${attOptions(set().currentAttendant)}</select>
          <div class="row"><button class="btn primary block" data-a="att-start">Iniciar atendimento</button></div>
          <div class="muted small">Ao finalizar, o encerramento fica no histórico. Com protocolo, também vai para Atendimentos salvos.</div>`}
      </div>
      <div class="card"><b>Registrar sem atendimento</b>
        <div class="row"><button class="btn ghost block" data-a="hist-add" data-k="venda">+ Venda</button><button class="btn ghost block" data-a="hist-add" data-k="visita">+ Visita</button></div>
      </div>
      <div class="card"><b>Pós-atendimento</b><div class="muted small">Ciclo atual: ${esc(ciclo)}. Mude os intervalos e os textos em Ajustes; aqui você troca a data de cada retorno deste cliente.</div>
        ${fus || '<div class="muted small">Nenhum retorno programado para este cliente.</div>'}
        <div class="row"><button class="link" data-a="fu-start" data-id="${esc(c.id)}">Programar ciclo a partir de agora</button>${fus ? `<button class="link" data-a="fu-cancel-all" data-id="${esc(c.id)}">Cancelar todos</button>` : ''}</div></div>
      <div class="card"><b>Histórico</b>${hist ? `<ul class="timeline">${hist}</ul>` : '<div class="muted small">Sem registros ainda.</div>'}</div>
      <div class="card"><b>Anotações</b>
        <textarea class="in" id="nt-text" rows="2" placeholder="Escreva uma observação…"></textarea>
        <div class="row"><button class="btn block" data-a="note-add">Salvar anotação</button></div>
        <ul class="timeline">${notes}</ul></div>`;
  }

  function ajustesTab() {
    const s = set();
    const cur = (OA.profiles && OA.profiles.get(s.profile)) || null;
    const perfil = `<div class="card"><b>Segmento</b>
        <div class="muted small">Escolha o seu ramo. Ele ajusta etapas do funil, etiquetas e textos de lembrete. Seus clientes e histórico ficam como estão.</div>
        <div class="muted small">Atual: ${cur ? esc(cur.name) : 'padrão'}</div>
        <div class="row"><select class="in" id="pf-sel">${(OA.profiles ? OA.profiles.list : []).map((p) => `<option value="${p.id}" ${s.profile === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <button class="btn primary" data-a="profile-apply">Aplicar perfil</button></div></div>`;
    const fuSel = [0, 1, 2, 3].map((i) => `<select class="in" data-sset="followupSteps.${i}">${'<option value="">— nenhum —</option>' + stepOptions(s.followupSteps[i])}</select>`).join('');
    const fuMsgs = [0, 1, 2, 3].map((i) => `<label class="f">Retorno ${i + 1}</label><textarea class="in" rows="2" data-sset="followupMsgs.${i}">${esc(s.followupMsgs[i] || '')}</textarea>`).join('');
    const bdMsgs = [0, 1, 2, 3].map((i) => `<label class="f">Variação ${i + 1}</label><textarea class="in" rows="2" data-sset="birthdayMsgs.${i}">${esc(s.birthdayMsgs[i] || '')}</textarea>`).join('');
    const svcList = (s.services || []).map((x, i) => `<div class="irow"><div class="itx"><b>${esc(x.name)}</b> <span class="muted small">${x.price ? 'R$ ' + esc(x.price) : 'sem valor'} · ${x.minutes || 60} min</span></div><button class="link" data-a="svc-del" data-i="${i}">remover</button></div>`).join('');
    const att = st().attendants.map((a, i) => `<div class="irow"><div class="itx"><b>${esc(a.name)}</b></div><button class="link" data-a="att-del" data-i="${i}">remover</button></div>`).join('');
    return `${perfil}<div class="card"><b>Avisos automáticos ao cliente</b>
        <label class="toggle"><span>Avisar ao iniciar, transferir e finalizar</span><span class="switch"><input type="checkbox" data-sset="autoMsgAtendimento" ${s.autoMsgAtendimento ? 'checked' : ''}><span></span></span></label>
        <label class="f">Ao iniciar</label><textarea class="in" rows="2" data-sset="msgIniciar">${esc(s.msgIniciar)}</textarea>
        <label class="f">Ao transferir</label><textarea class="in" rows="2" data-sset="msgTransferir">${esc(s.msgTransferir)}</textarea>
        <label class="f">Ao finalizar</label><textarea class="in" rows="2" data-sset="msgFinalizar">${esc(s.msgFinalizar)}</textarea>
        <div class="muted small">Use {atendente} para o nome de quem está atendendo.</div>
      </div>
      <div class="card"><b>Backup no Google Drive</b>
        <div class="muted small">Último backup: ${s.lastBackupAt ? fmtDate(s.lastBackupAt) : 'nunca'}. Salvo na sua conta Google, a cada 24 h.</div>
        ${OA.backup && OA.backup.lastError ? `<div class="muted small">Erro: ${esc(OA.backup.lastError)}</div>` : ''}
        <div class="row">${s.backupOn ? '<button class="btn primary block" data-a="bk-run">Fazer backup agora</button>' : '<button class="btn primary block" data-a="bk-connect">Conectar Google Drive</button>'}</div>
      </div>
      <div class="card"><b>Atendentes</b>${att || '<div class="muted small">Nenhum atendente cadastrado.</div>'}
        <div class="row"><input class="in" id="at-name" placeholder="Nome do atendente"><button class="btn" data-a="att-add">Adicionar</button></div>
        <label class="f">Atendente padrão</label><select class="in" data-sset="currentAttendant">${attOptions(s.currentAttendant)}</select></div>
      <div class="card"><b>Pós-atendimento (ciclo de mensagens)</b><div class="muted small">Até 4 retornos, de 2 horas a 6 meses. Cada intervalo é contado a partir do retorno anterior. O ciclo começa ao finalizar um atendimento ou registrar visita ou venda.</div>
        ${fuSel}${fuMsgs}${varsHint}</div>
      <div class="card"><b>Serviços</b><div class="muted small">Cadastre o serviço e o valor. Na agenda você escolhe qual entra no evento, e o lembrete cita esse serviço.</div>
        ${svcList || '<div class="muted small">Nenhum serviço cadastrado.</div>'}
        <div class="row"><input class="in" id="sv-name" placeholder="Serviço (ex.: limpeza completa)"><input class="in" id="sv-price" placeholder="Valor (ex.: 150,00)"><input class="in" id="sv-min" type="number" value="60" placeholder="min"><button class="btn" data-a="svc-add">Adicionar</button></div>
      </div>
      <div class="card"><b>Lembretes de consulta</b>${chipsHint(REMINDER_VARS)}
        <label class="toggle"><span>Enviar confirmação ao marcar pelo painel</span><span class="switch"><input type="checkbox" data-sset="confirmOnBooking" ${s.confirmOnBooking ? 'checked' : ''}><span></span></span></label>
        <label class="f">Confirmação da marcação</label><textarea class="in" rows="3" data-sset="confirmMsg">${esc(s.confirmMsg)}</textarea>
        <label class="f">Lembrete 1 dia antes</label><textarea class="in" rows="3" data-sset="reminder1dMsg">${esc(s.reminder1dMsg)}</textarea>
        <label class="f">Lembrete 6 h antes (turno vespertino/noturno)</label><textarea class="in" rows="3" data-sset="reminder6hMsg">${esc(s.reminder6hMsg)}</textarea>
        <label class="f">Início do turno vespertino (hora)</label><input class="in" type="number" min="0" max="23" data-sset="shiftCutoffHour" value="${s.shiftCutoffHour}">
      </div>
      <div class="card"><b>Aniversário</b><div class="muted small">Até 4 variações de mensagem.</div>${bdMsgs}${varsHint}</div>
      <div class="card"><b>Ritmo de envio (segurança)</b>
        <div class="row"><div><label class="f">Espera mínima (s)</label><input class="in" type="number" data-sset="minDelaySec" value="${s.minDelaySec}"></div>
        <div><label class="f">Espera máxima (s)</label><input class="in" type="number" data-sset="maxDelaySec" value="${s.maxDelaySec}"></div></div>
        <div class="row"><div><label class="f">Pausa a cada</label><input class="in" type="number" data-sset="pauseEvery" value="${s.pauseEvery}"></div>
        <div><label class="f">Pausa (min)</label><input class="in" type="number" data-sset="pauseMinutes" value="${s.pauseMinutes}"></div></div>
        <label class="f">Limite diário</label><input class="in" type="number" data-sset="dailyLimit" value="${s.dailyLimit}">
      </div>
      <div class="card"><b>Etapas do funil</b><div class="muted small">Edite os nomes no próximo ajuste de versão. Etapas atuais: ${st().stages.map((x) => esc(x.name)).join(', ')}.</div></div>`;
  }

  function agendaTab() {
    const s = set();
    const cal = OA.calendar || {};
    if (!s.gcalConnected) {
      return `<div class="card"><b>Google Agenda</b>
        <div class="muted small">Lê a agenda de cada unidade, programa os lembretes automáticos e deixa você marcar horários daqui.</div>
        <div class="row"><button class="btn primary block" data-a="cal-connect">Conectar Google Agenda</button></div>
        ${cal.lastError ? `<div class="muted small">${esc(cal.lastError)}</div>` : ''}</div>`;
    }
    const bk = ui.bk || {};
    const avail = s.availableCalendars || [];
    const chosen = new Map((s.calendars || []).map((c) => [c.id, c]));
    const units = avail.map((a) => {
      const c = chosen.get(a.id);
      return `<div class="irow"><input type="checkbox" data-a="cal-toggle" data-id="${esc(a.id)}" ${c ? 'checked' : ''}>
        <div class="itx"><b>${esc(a.name)}</b>${c ? `<input class="in" data-a="cal-unit" data-id="${esc(a.id)}" value="${esc(c.name)}" placeholder="Nome do profissional">
          <div class="row"><div><label class="f">Início</label><input class="in" type="time" data-a="cal-hours" data-k="start" data-id="${esc(a.id)}" value="${esc((c.hours || {}).start || '08:00')}"></div><div><label class="f">Fim</label><input class="in" type="time" data-a="cal-hours" data-k="end" data-id="${esc(a.id)}" value="${esc((c.hours || {}).end || '18:00')}"></div></div>` : ''}</div></div>`;
    }).join('');
    const now = Date.now();
    const q = st().queue.filter((x) => x.source === 'gcal');
    const scheduled = q.filter((x) => x.status === 'pending' && x.sendAt > now).sort((a, b) => a.sendAt - b.sendAt);
    const due = q.filter((x) => x.status === 'pending' && x.sendAt <= now);
    const sent = q.filter((x) => x.status === 'sent').sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)).slice(0, 15);
    const lbl = (x) => x.kind === 'lembrete-1d' ? '1 dia antes' : '6 h antes';
    const row = (x, pill) => `<div class="item"><div class="top"><span class="ttl">${esc(x.name || x.phone)}</span><span class="pill ${pill[1]}">${pill[0]}</span></div>
      <div class="muted small">${esc(x.unit || '')} · ${lbl(x)} · ${x.sendAt ? fmtDate(x.sendAt) : ''}</div>
      ${x.err ? `<div class="muted small">${esc(x.err)}</div>` : ''}</div>`;
    return `<div class="card"><b>Google Agenda conectada</b>
        <div class="muted small">Última leitura: ${s.lastSyncAt ? fmtDate(s.lastSyncAt) : 'nunca'}</div>
        ${cal.lastError ? `<div class="muted small">Erro: ${esc(cal.lastError)}</div>` : ''}
        <div class="row"><button class="btn primary block" data-a="cal-sync">Sincronizar agora</button><button class="btn ghost block" data-a="cal-disconnect">Desconectar</button></div>
      </div>
      <div class="card"><b>Agendar serviço</b><div class="muted small">Cria o evento na agenda da unidade. Os lembretes saem automaticamente.</div>
        ${(s.calendars || []).length && (s.services || []).length ? `
        <label class="f">Profissional (agenda)</label><select class="in" id="bk-cal">${(s.calendars || []).map((c) => `<option value="${esc(c.id)}" ${bk.cal === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <div class="row"><div><label class="f">Data</label><input class="in" type="date" id="bk-date" value="${esc(bk.date || '')}"></div></div>
        <label class="f">Cliente</label><input class="in" id="bk-name" placeholder="Nome" value="${esc(bk.name != null ? bk.name : (ui.bookFor || {}).name || '')}">
        <label class="f">Telefone (com DDD)</label><input class="in" id="bk-phone" placeholder="(79) 99999-9999" value="${esc(bk.phone != null ? bk.phone : (ui.bookFor || {}).phone || '')}">
        <label class="f">Profissional</label><input class="in" id="bk-prof" placeholder="Opcional" value="${esc(bk.prof || '')}">
        <label class="f">Serviço</label><select class="in" id="bk-svc">${(s.services || []).map((x, i) => `<option value="${i}" ${String(bk.svc) === String(i) ? 'selected' : ''}>${esc(x.name)}${x.price ? ' · R$ ' + esc(x.price) : ''}</option>`).join('')}</select>
        <div class="row"><button class="btn ghost block" data-a="slots-find">Encontrar horário</button></div>
        <div class="row wrap">${(bk.slots || []).map((ms) => `<button class="chip ${bk.pick === ms ? 'on' : ''}" data-a="slot-pick" data-t="${ms}">${hm(ms)}</button>`).join('') || '<div class="muted small">Escolha data e serviço e clique em Encontrar horário.</div>'}</div>
        <div class="row"><button class="btn primary block" data-a="cal-create">Criar na agenda</button></div>`
        : '<div class="muted small">Escolha uma unidade abaixo e cadastre serviços em Ajustes para agendar.</div>'}</div>
      <div class="card"><b>Unidades</b><div class="muted small">Marque uma agenda por unidade e dê um nome. Cada evento deve ter na descrição as linhas <i>Tel: (79) 99999-9999</i> e <i>Profissional: Nome</i>. Para não lembrar, escreva <i>sem lembrete</i>.</div>
        ${units || '<div class="muted small">Nenhuma agenda encontrada.</div>'}</div>
      <div class="card"><b>Programados (${scheduled.length})</b>
        ${scheduled.map((x) => row(x, ['Programado', 'blue'])).join('') || '<div class="muted small">Nenhum lembrete programado.</div>'}</div>
      ${due.length ? `<div class="card"><b>Na fila agora (${due.length})</b>${due.map((x) => row(x, ['Na fila', 'gold'])).join('')}</div>` : ''}
      <div class="card"><b>Enviados</b>${sent.map((x) => row(x, ['Enviado', 'ok'])).join('') || '<div class="muted small">Nenhum lembrete enviado ainda.</div>'}</div>`;
  }

  const TAB_FN = { hoje: hojeTab, atend: atendTab, agenda: agendaTab, aniv: anivTab, clientes: clientesTab, funil: funilTab, cliente: clienteTab, ajustes: ajustesTab };

  function render() {
    if (!body) return;
    const head = shadow.querySelector('.tabs');
    if (head) head.innerHTML = TABS.map(([k, l]) => `<button class="${ui.tab === k ? 'on' : ''}" data-a="tab" data-t="${k}" title="${l}">${ICON[k]}<span>${l}</span></button>`).join('');
    // Marca do cliente (definida no painel de licenças) e segmento escolhido.
    const br = set().brand || {};
    const prof = OA.profiles && OA.profiles.get(set().profile);
    const bn = shadow.querySelector('.brand-name'), bs = shadow.querySelector('.brand-sub'), bl = shadow.querySelector('.brand-logo');
    if (bn) bn.textContent = br.name || 'Opex Fideliza';
    if (bs) bs.textContent = br.name ? 'Opex Fideliza' : (prof ? prof.name : 'CRM para WhatsApp');
    if (bl && br.logo && bl.getAttribute('src') !== br.logo) bl.src = br.logo;
    if (!OA.license.ok) { body.innerHTML = lockCard(); return; }
    body.innerHTML = (TAB_FN[ui.tab] || hojeTab)();
    const n = E.dueFollowups().length;
    const badge = launcher && launcher.querySelector('.badge');
    if (badge) { badge.textContent = n; badge.style.display = n ? '' : 'none'; }
  }

  function schedule() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => { renderQueued = false; render(); }, 150);
  }

  // ---------- ações ----------
  const ACTIONS = {
    tab: (el) => { if (el.dataset.t !== 'agenda') ui.bookFor = null; ui.tab = el.dataset.t; render(); },
    'slots-find': async () => {
      const b = saveBk();
      const s = set();
      const cal = (s.calendars || []).find((c) => c.id === b.cal);
      const svc = (s.services || [])[Number(b.svc)];
      if (!cal || !svc || !b.date) { toast('Escolha unidade, data e serviço.'); return; }
      ui.bk = { ...b, slots: [], pick: null };
      ui.bk.slots = await OA.calendar.findSlots({ calId: cal.id, date: b.date, durationMin: svc.minutes, hours: cal.hours });
      if (!ui.bk.slots.length) toast('Sem horários livres nesse dia.');
      render();
    },
    'slot-pick': (el) => { saveBk(); ui.bk.pick = Number(el.dataset.t); render(); },
    'appt-new': (el) => { const c = S.contact(el.dataset.id); ui.bookFor = c ? { name: c.name || '', phone: c.phone || '' } : null; ui.tab = 'agenda'; render(); },
    open: (el) => { ui.activeId = el.dataset.id; ui.tab = 'cliente'; render(); },
    'bd-preset': (el) => { ui.bdPreset = el.dataset.k; ui.bdSel.clear(); render(); },
    'bd-toggle': (el) => { el.checked ? ui.bdSel.add(el.dataset.id) : ui.bdSel.delete(el.dataset.id); render(); },
    'bd-all': () => {
      const [from, to] = periodRange();
      Object.values(st().contacts).filter((c) => E.birthdayIn(c, from, to)).forEach((c) => ui.bdSel.add(c.id));
      render();
    },
    'bd-send': () => {
      const msgs = set().birthdayMsgs.filter(Boolean);
      const n = E.enqueueBroadcast([...ui.bdSel], 'aniversario', msgs);
      ui.bdSel.clear();
      toast(`${n} mensagem(ns) na fila.`);
      E.tick();
      render();
    },
    'bd-cancel': () => { E.cancelBroadcast(); toast('Fila cancelada.'); render(); },
    stage: (el) => { const c = activeContact(); if (c) { S.setStage(c.id, el.dataset.id); S.commit(true); render(); } },
    tag: (el) => { const c = activeContact(); if (c) { S.toggleTag(c.id, el.dataset.id); S.commit(true); render(); } },
    'att-start': () => {
      const c = activeContact(); if (!c) return;
      const att = shadow.getElementById('st-att').value || set().currentAttendant;
      if (!att) { toast('Escolha um atendente.'); return; }
      set().currentAttendant = att;
      if (!S.startAttendance(c.id, att)) return toast('Já existe um atendimento aberto.');
      S.commit(true);
      E.notifyClient(c, set().msgIniciar, S.attName(att));
      toast('Atendimento iniciado.'); render();
    },
    'att-transfer': () => {
      const c = activeContact(); if (!c) return;
      const to = shadow.getElementById('tr-att').value;
      if (!to || !S.transferAttendance(c.id, to)) return toast('Escolha outro atendente.');
      S.commit(true);
      E.notifyClient(c, set().msgTransferir, S.attName(to));
      toast('Atendimento transferido.'); render();
    },
    'att-close': () => closeAtt(false),
    'att-close-save': () => closeAtt(true),
    'hist-add': (el) => {
      const c = activeContact(); if (!c) return;
      const k = el.dataset.k;
      const value = k === 'venda' ? Number(prompt('Valor da venda (R$)', '0')) || 0 : 0;
      const text = prompt(k === 'venda' ? 'Descrição da venda' : 'O que foi feito na visita?', '') || '';
      S.addHistory(c.id, { type: k, text, value, attId: set().currentAttendant });
      S.addNote(c.id, `${TYPE_LABEL[k]} registrada`, 'auto');
      S.scheduleFollowups(c.id, Date.now());
      S.commit(true); toast(`${TYPE_LABEL[k]} registrada e pós-atendimento programado.`); render();
    },
    'note-add': () => {
      const c = activeContact(); if (!c) return;
      const t = shadow.getElementById('nt-text').value.trim();
      if (t) { S.addNote(c.id, t, 'note'); S.commit(true); render(); }
    },
    'fu-now': (el) => {
      const c = S.contact(el.dataset.id); if (!c) return;
      const f = c.followups.find((x) => x.id === el.dataset.f);
      if (f) { f.ts = Date.now(); E.tick(); }
      S.commit(true); render();
    },
    'fu-cancel': (el) => {
      const c = S.contact(el.dataset.id); if (!c) return;
      const f = c.followups.find((x) => x.id === el.dataset.f);
      if (f && f.status === 'pending') f.status = 'skipped';
      S.commit(true); render();
    },
    'fu-start': (el) => { S.scheduleFollowups(el.dataset.id, Date.now()); S.commit(true); toast('Pós-atendimento programado.'); render(); },
    'fu-cancel-all': (el) => { S.cancelFollowups(el.dataset.id); S.commit(true); render(); },
    'att-add': () => {
      const n = shadow.getElementById('at-name').value.trim();
      if (!n) return;
      st().attendants.push({ id: U.uid(), name: n });
      S.commit(true); render();
    },
    'att-filter': (el) => { ui.attFilter = el.dataset.k; render(); },
    assume: (el) => {
      const c = S.contact(el.dataset.id); if (!c) return;
      const att = set().currentAttendant;
      if (!att) return toast('Escolha quem é você em Atendimento.');
      if (S.startAttendance(c.id, att)) { S.commit(true); E.notifyClient(c, set().msgIniciar, S.attName(att)); }
      ui.activeId = c.id; ui.tab = 'cliente'; render();
    },
    'att-del': (el) => { st().attendants.splice(Number(el.dataset.i), 1); S.commit(true); render(); },
    'lk-login': async () => {
      await OA.license.login(shadow.getElementById('lk-login').value, shadow.getElementById('lk-pass').value);
      render();
    },
    'lk-key': async () => {
      await OA.license.activate(shadow.getElementById('lk-key').value);
      render();
    },
    'panel-toggle': () => { drawer.classList.toggle('open'); },
    'bk-connect': async () => { await OA.backup.connect(); toast('Drive conectado. Fazendo o primeiro backup…'); await OA.backup.run(); render(); },
    'bk-run': async () => { const ok = await OA.backup.run(); toast(ok ? 'Backup salvo no seu Drive.' : (OA.backup.lastError || 'Falha no backup.')); render(); },
    'cal-connect': async () => { await OA.calendar.connect(); toast('Agenda conectada. Escolha as unidades.'); render(); },
    'cal-sync': async () => { const n = await OA.calendar.sync(); toast(n != null ? `${n} lembrete(s) novo(s).` : (OA.calendar.lastError || 'Sincronizado.')); render(); },
    'svc-add': () => {
      const name = shadow.getElementById('sv-name').value.trim();
      if (!name) return;
      set().services = [...(set().services || []), { name, price: shadow.getElementById('sv-price').value.trim(), minutes: Number(shadow.getElementById('sv-min').value) || 60 }];
      S.commit(true); render();
    },
    'svc-del': (el) => { set().services.splice(Number(el.dataset.i), 1); S.commit(true); render(); },
    'cal-create': async () => {
      const b = saveBk();
      const s = set();
      const cal = (s.calendars || []).find((c) => c.id === b.cal);
      const svc = (s.services || [])[Number(b.svc)];
      if (!cal || !svc || !b.date || !b.name || !b.phone || b.pick == null) { toast('Escolha unidade, data, serviço, cliente, telefone e um horário livre.'); return; }
      const startMs = b.pick;
      try {
        await OA.calendar.createEvent({ calId: cal.id, startMs, durationMin: svc.minutes, name: b.name, phone: b.phone, professional: b.prof, service: svc.name });
        await OA.calendar.sync();
        let sent = false;
        if (s.confirmOnBooking && s.confirmMsg) {
          const text = OA.calendar.render(s.confirmMsg, { evt: { name: b.name, phone: b.phone, professional: b.prof, service: svc.name, start: startMs }, unit: cal });
          try { await E.send({ phone: b.phone }, text); sent = true; } catch (e) { toast('Evento criado, mas a confirmação não saiu: ' + (e.message || e)); ui.bk = {}; render(); return; }
        }
        ui.bk = {}; ui.bookFor = null;
        toast(sent ? 'Horário marcado e confirmação enviada ao cliente.' : 'Evento criado na agenda e lembretes programados.');
      } catch (e) { toast(e.message || 'Não foi possível criar o evento.'); }
      render();
    },
    'copy-var': async (el) => {
      const text = el.dataset.v;
      try { await navigator.clipboard.writeText(text); }
      catch (_) { const t = document.createElement('textarea'); t.value = text; shadow.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      toast('Copiado: ' + text);
    },
    'profile-apply': () => {
      const id = shadow.getElementById('pf-sel').value;
      const p = OA.profiles.get(id);
      if (!p) return;
      if (!confirm('Aplicar o perfil "' + p.name + '"? As etapas do funil e os textos de lembrete serão trocados. Seus clientes e históricos continuam.')) return;
      OA.profiles.apply(id);
      toast('Perfil aplicado: ' + p.name); render();
    },
    'cl-toggle': (el) => { ui.clOpen = ui.clOpen === el.dataset.id ? null : el.dataset.id; render(); },
    'cal-disconnect': async () => { await OA.calendar.disconnect(); toast('Agenda desconectada.'); render(); },
    'cal-toggle': (el) => {
      const s = set();
      const list = (s.calendars || []).filter((c) => c.id !== el.dataset.id);
      if (el.checked) {
        const a = (s.availableCalendars || []).find((x) => x.id === el.dataset.id);
        list.push({ id: el.dataset.id, name: a ? a.name : el.dataset.id });
      }
      s.calendars = list; S.commit(true); render();
    },
  };

  function closeAtt(save) {
    const c = activeContact(); if (!c) return;
    const reason = shadow.getElementById('fz-text').value.trim();
    const fuOn = shadow.getElementById('fz-fu');
    const withFu = !!(fuOn && fuOn.checked);
    const rec = S.closeAttendance(c.id, { reason, saveProtocol: save });
    if (!rec) return toast('Nenhum atendimento aberto.');
    if (withFu) S.scheduleFollowups(c.id, Date.now());
    S.commit(true);
    E.notifyClient(c, set().msgFinalizar, S.attName(rec.attId));
    toast(save ? `Salvo: ${rec.protocol}` : 'Atendimento finalizado.');
    render();
  }

  function atendTab() {
    const f = ui.attFilter || 'fila';
    const all = Object.values(st().contacts);
    const open = all.filter((c) => c.attendance && c.attendance.status === 'open');
    const me = set().currentAttendant;
    const queue = all.filter((c) => !c.attendance && c.lastInbound && !(c.history || []).some((h) => h.type === 'atendimento' && h.ts > c.lastInbound)).sort((a, b) => b.lastInbound - a.lastInbound);
    const lists = {
      fila: { label: 'Fila', items: queue },
      meus: { label: 'Meus', items: open.filter((c) => c.attendance.attId === me) },
      andamento: { label: 'Em atendimento', items: open },
      finalizados: { label: 'Finalizados', items: st().atendimentos.slice(0, 40).map((r) => ({ _rec: r })) },
    };
    const L = lists[f] || lists.fila;
    const rows = L.items.map((x) => {
      if (x._rec) { const r = x._rec; return `<div class="item"><div class="top"><span class="ttl">${esc(r.name)}</span><span class="pill ${r.saved ? 'gold' : ''}">${r.saved ? esc(r.protocol) : 'sem protocolo'}</span></div><div class="muted small">${fmtDate(r.endedAt)} · ${esc(S.attName(r.attId))} · ${r.minutes} min${r.reason ? ' · ' + esc(r.reason) : ''}</div></div>`; }
      const c = x;
      return `<div class="item" data-a="open" data-id="${esc(c.id)}"><div class="top"><span class="ttl">${esc(cname(c))}</span>${c.attendance ? `<span class="pill blue">${esc(S.attName(c.attendance.attId))}</span>` : '<span class="pill gold">aguardando</span>'}</div>
        <div class="muted small">${U.formatPhone(c.phone)}${c.lastInbound ? ' · ' + U.relTime(c.lastInbound) : ''}</div>
        ${!c.attendance ? `<div class="row"><button class="link" data-a="assume" data-id="${esc(c.id)}">Assumir</button></div>` : ''}</div>`;
    }).join('');
    const filters = Object.entries(lists).map(([k, v]) => `<button class="chip ${f === k ? 'on' : ''}" data-a="att-filter" data-k="${k}">${v.label} (${v.items.length})</button>`).join('');
    const rep = S.report();
    const repRows = rep.map((r) => `<div class="irow"><div class="itx"><b>${esc(r.name)}</b><small>${r.open} em atendimento · ${r.doneToday} finalizados hoje · média ${r.avgMinutes} min</small></div></div>`).join('') || '<div class="muted small">Cadastre atendentes em Ajustes.</div>';
    const saved = st().atendimentos.filter((r) => r.saved).slice(0, 30).map((r) => `<div class="item"><div class="top"><span class="ttl">${esc(r.protocol)}</span><span class="muted small">${fmtDate(r.endedAt)}</span></div><div class="muted small">${esc(r.name)} · ${esc(S.attName(r.attId))} · ${r.minutes} min${r.reason ? ' · ' + esc(r.reason) : ''}</div></div>`).join('');
    return `<div class="card"><b>Quem sou eu</b><div class="muted small">Essas ações saem com o seu nome.</div>
        <select class="in" data-sset="currentAttendant">${attOptions(me)}</select></div>
      <div class="card"><div class="row wrap">${filters}</div>${rows || '<div class="muted small">Nada nesta lista.</div>'}</div>
      <div class="card"><b>Relatório</b>${repRows}</div>
      <div class="card"><b>Atendimentos salvos</b>${saved || '<div class="muted small">Nenhum protocolo salvo ainda.</div>'}</div>`;
  }

  function toast(msg) {
    const el = shadow.querySelector('.toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- montagem ----------
  ui.setActive = (info) => {
    if (!info || info.isGroup || !info.id) return;
    const c = S.upsertContact(info.id, { name: info.name || '', phone: info.phone || '' });
    ui.activeId = c.id;
    S.commit(true);
    if (drawer && drawer.classList.contains('open')) render();
  };
  ui.refreshChats = () => schedule();
  ui.render = () => schedule();
  ui.schedule = () => schedule();

  ui.mount = async () => {
    const host = document.createElement('div');
    host.id = 'opex-care-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    const css = await fetch(chrome.runtime.getURL('src/ui.css')).then((r) => r.text());
    const logo = chrome.runtime.getURL('icons/icon48.png');
    shadow.innerHTML = `<style>${css}</style>
      <button class="launcher" data-a="panel-toggle" title="Abrir Opex Fideliza"><img src="${logo}" alt="Opex Fideliza"><span class="badge" style="display:none">0</span></button>
      <aside class="drawer open">
        <div class="head"><img class="brand-logo" src="${logo}" alt=""><div class="brand"><b class="brand-name">Opex Fideliza</b><span class="brand-sub">CRM para WhatsApp</span></div>
          <button class="icon-btn" data-a="panel-toggle" title="Fechar">✕</button></div>
        <nav class="tabs"></nav>
        <div class="body"></div>
        <div class="toast"></div>
      </aside>`;
    drawer = shadow.querySelector('.drawer');
    body = shadow.querySelector('.body');
    launcher = shadow.querySelector('.launcher');
    shadow.addEventListener('click', (e) => {
      const el = e.target.closest('[data-a]');
      if (!el) return;
      const fn = ACTIONS[el.dataset.a];
      if (fn) { e.stopPropagation(); Promise.resolve(fn(el)).catch((err) => toast(err.message || String(err))); }
    });
    shadow.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'cl-q') { ui.clQuery = e.target.value; refreshClientesList(); }
    });
    shadow.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.a === 'appt-status') { const a = (st().appointments || []).find((x) => x.id === t.dataset.id); if (a) { a.localStatus = t.value; S.commit(true); toast('Status atualizado.'); render(); } return; }
      if (t.dataset.a === 'bd-from') { ui.bdFrom = t.value; render(); return; }
      if (t.dataset.a === 'bd-to') { ui.bdTo = t.value; render(); return; }
      if (t.dataset.a === 'fu-date') {
        const c = S.contact(t.dataset.id); const f = c && c.followups.find((x) => x.id === t.dataset.f);
        if (f && f.status === 'pending' && t.value) {
          const old = new Date(f.ts); const d = new Date(t.value + 'T00:00:00'); d.setHours(old.getHours(), old.getMinutes(), 0, 0);
          f.ts = d.getTime(); c.followups.sort((a, b) => a.ts - b.ts); S.commit(true); toast('Data do retorno alterada.'); render();
        }
        return;
      }
      if (t.dataset.a === 'cal-hours') {
        set().calendars = (set().calendars || []).map((c) => (c.id === t.dataset.id ? { ...c, hours: { ...(c.hours || {}), [t.dataset.k]: t.value } } : c));
        S.commit(true); return;
      }
      if (t.dataset.a === 'cal-unit') {
        set().calendars = (set().calendars || []).map((c) => (c.id === t.dataset.id ? { ...c, name: t.value } : c));
        S.commit(true); return;
      }
      if (t.dataset.lset) {
        const c = activeContact(); if (!c) return;
        (c.profile = c.profile || {}).lead = { ...(c.profile.lead || {}), [t.dataset.lset]: t.value };
        S.commit(true); return;
      }
      if (t.dataset.cset) {
        const c = activeContact(); if (!c) return;
        if (t.dataset.cset === 'attId') { if (c.attendance) c.attendance.attId = t.value; set().currentAttendant = t.value; }
        else c[t.dataset.cset] = t.value;
        S.commit(true); return;
      }
      if (t.dataset.sset) {
        const [k, idx] = t.dataset.sset.split('.');
        const v = t.type === 'number' ? Number(t.value) || 0 : t.type === 'checkbox' ? t.checked : t.value;
        if (idx !== undefined) {
          const arr = set()[k];
          arr[Number(idx)] = v || (k === 'followupSteps' ? '' : '');
          if (k === 'followupSteps') set().followupSteps = arr.filter(Boolean).slice(0, 4);
        } else set()[k] = v;
        S.commit(true);
      }
    });
    S.subscribe(() => schedule());
    ui.ready = true;
    render();
  };

})();
