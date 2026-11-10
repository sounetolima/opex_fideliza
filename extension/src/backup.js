// Opex Fideliza — backup automático no Google Drive do próprio cliente (permissão drive.file: só arquivos criados pela extensão).
/* global chrome, OA */
(() => {
  'use strict';
  const S = OA.store;
  const set = () => S.state.settings;
  const B = (OA.backup = { lastError: '', running: false });
  const DAY = 24 * 3600e3;

  const askToken = (interactive) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'gcal-token', interactive }, (r) => resolve(r || { error: 'Sem resposta do serviço de fundo' }));
  });

  // Conecta (pede o consentimento do Drive). Depois disso o backup roda sozinho.
  B.connect = async () => {
    const t = await askToken(true);
    if (t.error) throw new Error(t.error);
    set().backupOn = true; S.commit(true);
    return true;
  };

  // Envia o estado inteiro como um JSON. Atualiza o mesmo arquivo a cada backup.
  B.run = async () => {
    if (B.running || !set().backupOn) return false;
    B.running = true;
    try {
      const t = await askToken(false);
      if (t.error) throw new Error(t.error);
      const payload = { app: 'opex-care', version: 2, exportedAt: new Date().toISOString(), data: { ...S.state, queue: [] } };
      const boundary = 'opexcare' + Date.now();
      const meta = { name: 'opex-care-backup.json', mimeType: 'application/json' };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--`;
      const id = set().backupFileId;
      const url = id
        ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
      const r = await fetch(url, {
        method: id ? 'PATCH' : 'POST',
        headers: { Authorization: 'Bearer ' + t.token, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      if (r.status === 401) { await new Promise((res) => chrome.runtime.sendMessage({ type: 'gcal-revoke' }, res)); throw new Error('Conexão com o Drive expirou. Conecte de novo.'); }
      if (!r.ok) throw new Error('Drive respondeu ' + r.status);
      const j = await r.json();
      set().backupFileId = j.id;
      set().lastBackupAt = Date.now();
      B.lastError = '';
      S.commit(true);
      return true;
    } catch (e) {
      B.lastError = e.message || String(e);
      S.commit(true);
      return false;
    } finally {
      B.running = false;
    }
  };

  // Chamado pelo relógio: backup a cada 24 h, se estiver conectado.
  B.maybeRun = () => {
    if (!set().backupOn) return;
    if (Date.now() - (set().lastBackupAt || 0) < DAY) return;
    B.run();
  };
})();
