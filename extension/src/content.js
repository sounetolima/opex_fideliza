// Opex Agent — inicialização no WhatsApp Web.
/* global chrome, OA */
(async () => {
  'use strict';
  if (window.top !== window || window.__opexAgentContent) return;
  window.__opexAgentContent = true;

  const { store: S, engine: E, bridge: B, ui } = OA;

  let readyOnce = false;
  await S.load();
  E.recover();
  await ui.mount();
  // Licença: o painel abre travado até validar; ao liberar, o motor volta a rodar.
  OA.license.listeners.push(() => {
    ui.render();
    if (OA.license.ok && readyOnce) {
      ui.refreshChats();
      E.tick();
    }
  });
  OA.license.init().catch((e) => console.warn('[Opex Agent] licença', e));

  async function onReady() {
    if (readyOnce) return;
    readyOnce = true;
    E.ready = true;
    ui.ready = true;
    try { const st = await B.call('status', {}, 6000); if (st && st.me) OA.license.setWa(st.me.split('@')[0]); } catch (_) {}
    try { ui.setActive(await B.call('activeChat')); } catch (_) {}
    ui.render();
    ui.refreshChats();
    E.tick();
  }

  B.on('ready', onReady);
  B.on('active_chat', (info) => ui.setActive(info));
  B.on('new_message', (m) => { E.onMessage(m).catch((e) => console.warn('[Opex Agent]', e)); clearTimeout(ui._nm); ui._nm = setTimeout(() => ui.refreshChats(), 1500); });
  setInterval(() => { if (ui.tab === 'inbox') ui.refreshChats(); }, 25000);

  // A ponte pode ter ficado pronta antes deste script: consulta o status até confirmar.
  (async function poll(tries) {
    if (readyOnce) return;
    try {
      const s = await B.call('status', {}, 4000);
      if (s && s.ready) return onReady();
    } catch (_) {}
    if (tries < 240) setTimeout(() => poll(tries + 1), 2500);
  })(0);

  // Relógio: a cada 20 s localmente + alarme do service worker a cada minuto.
  setInterval(() => E.tick(), 20000);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'tick') E.tick();
  });
  // Atualiza tempos relativos ("há 5 min") no painel.
  setInterval(() => ui.schedule(), 60000);
})();
