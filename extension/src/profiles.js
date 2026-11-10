// Opex Fideliza — perfis por segmento: etapas do funil, etiquetas e textos de lembrete.
// Mesma extensão para todos; o perfil só muda o ponto de partida. Não apaga clientes nem históricos.
/* global OA */
(() => {
  'use strict';
  const P = (OA.profiles = {});

  const T = (id, name, color) => ({ id, name, color });
  const COLORS = { blue: '#60A5FA', royal: '#3D63DD', lilac: '#A78BFA', gold: '#D4AA46', green: '#22C55E', grey: '#94A3B8', red: '#EF4444' };

  P.list = [
    {
      id: 'clinica', name: 'Clínicas e odontologia',
      stages: [T('novo', 'Novo contato', COLORS.blue), T('agendado', 'Agendado', COLORS.royal), T('atendido', 'Atendido', COLORS.lilac), T('orcamento', 'Orçamento', COLORS.gold), T('fechado', 'Fechado', COLORS.green), T('inativo', 'Inativo', COLORS.grey)],
      tags: [T('vip', 'VIP', COLORS.gold), T('retorno', 'Retorno', COLORS.royal), T('convenio', 'Convênio', COLORS.green), T('urgente', 'Urgente', COLORS.red)],
      settings: {
        followupSteps: ['2h', '7d', '15d', '180d'],
        followupMsgs: [
          '{saudacao}, {primeiro_nome}! Tudo bem por aí? Passando para saber como você está após o atendimento. 😊',
          '{primeiro_nome}, tudo certo com você? Se sentir qualquer coisa diferente, é só me avisar por aqui.',
          '{saudacao}, {primeiro_nome}! Lembrando que estamos à disposição. Ficou alguma dúvida sobre o seu tratamento?',
          '{saudacao}, {primeiro_nome}! Já faz 6 meses do seu último atendimento. Vamos marcar a sua revisão?',
        ],
        reminder1dMsg: '{saudacao}, {primeiro_nome}! Lembrete: amanhã ({data}) às {hora} você tem {servico} na {unidade} com {profissional}. Estamos aguardando a sua presença! 😊',
        reminder6hMsg: '{saudacao}, {primeiro_nome}! Hoje às {hora} você tem {servico} na {unidade}. Até logo! 👋',
      },
    },
    {
      id: 'salao', name: 'Salões e barbearias',
      stages: [T('novo', 'Novo cliente', COLORS.blue), T('agendado', 'Agendado', COLORS.royal), T('atendido', 'Atendido', COLORS.lilac), T('espera', 'Lista de espera', COLORS.gold), T('fiel', 'Fiel', COLORS.green), T('sumido', 'Sumido', COLORS.grey)],
      tags: [T('vip', 'VIP', COLORS.gold), T('retorno', 'Retorno', COLORS.royal), T('pacote', 'Pacote', COLORS.green), T('noiva', 'Noiva', COLORS.lilac)],
      settings: {
        followupSteps: ['2h', '30d', '30d'],
        followupMsgs: [
          '{primeiro_nome}, obrigado pela visita hoje! Gostou do resultado? 😊',
          '{saudacao}, {primeiro_nome}! Já faz um mês do seu último horário. Quer que eu separe um horário para você esta semana?',
          '{primeiro_nome}, estamos com saudade! Tem horário disponível esta semana. Posso reservar para você?',
          '',
        ],
        reminder1dMsg: '{saudacao}, {primeiro_nome}! Amanhã às {hora} você tem horário: {servico} com {profissional} na {unidade}. Te esperamos! ✂️',
        reminder6hMsg: '{saudacao}, {primeiro_nome}! Hoje às {hora} é o seu horário: {servico}. Até já! 💈',
      },
    },
    {
      id: 'seguros', name: 'Corretoras de seguros',
      stages: [T('novo', 'Lead', COLORS.blue), T('cotacao', 'Cotação', COLORS.royal), T('proposta', 'Proposta enviada', COLORS.gold), T('fechado', 'Apólice ativa', COLORS.green), T('renovacao', 'Renovação', COLORS.lilac), T('perdido', 'Perdido', COLORS.grey)],
      tags: [T('vip', 'VIP', COLORS.gold), T('auto', 'Auto', COLORS.royal), T('vida', 'Vida', COLORS.green), T('empresarial', 'Empresarial', COLORS.lilac), T('urgente', 'Urgente', COLORS.red)],
      settings: {
        followupSteps: ['2h', '3d', '7d'],
        followupMsgs: [
          '{saudacao}, {primeiro_nome}! Obrigado pelo contato. Qualquer dúvida sobre cobertura ou sinistro, é só chamar por aqui.',
          '{saudacao}, {primeiro_nome}! Conseguiu ver a proposta que enviei? Posso esclarecer algum ponto?',
          '{primeiro_nome}, a condição da sua proposta ainda está válida. Quer que eu finalize para você?',
          '',
        ],
        reminder1dMsg: '{saudacao}, {primeiro_nome}! Sua apólice de {servico} vence em {data}. Quer que eu cuide da renovação para você? 😊',
        reminder6hMsg: '{saudacao}, {primeiro_nome}! Hoje vence sua apólice de {servico}. Me responda para renovarmos agora.',
      },
    },
    {
      id: 'varejo', name: 'Varejo',
      stages: [T('novo', 'Lead', COLORS.blue), T('interessado', 'Interessado', COLORS.royal), T('comprou', 'Comprou', COLORS.green), T('posvenda', 'Pós-venda', COLORS.lilac), T('recompra', 'Recompra', COLORS.gold), T('inativo', 'Inativo', COLORS.grey)],
      tags: [T('vip', 'VIP', COLORS.gold), T('garantia', 'Garantia', COLORS.royal), T('cupom', 'Cupom', COLORS.green), T('recompra', 'Recompra', COLORS.lilac)],
      settings: {
        followupSteps: ['2h', '30d', '60d'],
        followupMsgs: [
          '{saudacao}, {primeiro_nome}! Obrigado pela compra. Deu tudo certo? Se precisar de qualquer ajuste, é só chamar. 😊',
          '{saudacao}, {primeiro_nome}! Como está sendo a experiência com o que você levou? Chegaram novidades que combinam com você.',
          '{primeiro_nome}, já está na hora de repor ou renovar? Separei algumas opções para você.',
          '',
        ],
        reminder1dMsg: '{saudacao}, {primeiro_nome}! Lembrete: amanhã ({data}) às {hora} você tem {servico} na {unidade}. Te esperamos! 🛍️',
        reminder6hMsg: '{saudacao}, {primeiro_nome}! Hoje às {hora}: {servico} na {unidade}. Até já! 😊',
      },
    },
  ];

  P.get = (id) => P.list.find((p) => p.id === id);

  // Aplica o perfil: troca etapas e textos; etiquetas novas são acrescentadas (as antigas ficam).
  // Cliente em etapa que não existe no perfil novo volta para a primeira etapa.
  P.apply = (id) => {
    const p = P.get(id);
    const S = OA.store, st = S.state;
    if (!p) return false;
    st.stages = p.stages.map((s) => ({ ...s }));
    const ids = new Set(st.stages.map((s) => s.id));
    Object.values(st.contacts).forEach((c) => { if (!ids.has(c.stageId)) c.stageId = st.stages[0].id; });
    p.tags.forEach((t) => { if (!st.tags.some((x) => x.id === t.id || x.name === t.name)) st.tags.push({ ...t }); });
    Object.assign(st.settings, p.settings, { profile: p.id });
    S.commit(true);
    return true;
  };
})();
