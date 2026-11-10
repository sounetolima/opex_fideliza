// Opex Agent — configuração do motor wa-js (roda antes dele, no contexto da página).
// Desliga telemetria, nome de dispositivo e "powered by" para não alterar nada visível na conta.
window.WPPConfig = Object.assign({}, window.WPPConfig, {
  disableGoogleAnalytics: true,
  googleAnalyticsId: null,
  deviceName: false,
  poweredBy: null,
  sendStatusToDevice: false,
  linkPreviewApiServers: null,
});

// A biblioteca imprime avisos internos quando o WhatsApp muda módulos que o Opex Agent não usa.
// Não afetam o funcionamento; filtramos só essas mensagens para não poluir a página de erros da extensão.
(() => {
  const noise = /Module \w+ was not found with|func is not (a function|an exported function)/;
  for (const k of ['error', 'warn']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { try { if (a.some((x) => noise.test(typeof x === 'string' ? x : (x && x.message) || ''))) return; } catch (_) {} orig(...a); };
  }
})();
