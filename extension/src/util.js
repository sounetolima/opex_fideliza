// Opex Fideliza — utilitários e cliente da ponte com o WhatsApp.
/* global chrome */
var OA = (globalThis.OA = globalThis.OA || {});

(() => {
  'use strict';

  const SRC_OUT = 'opex-agent:cs';
  const SRC_IN = 'opex-agent:page';
  const pending = new Map();
  const listeners = new Map();
  let seq = 0;

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC_IN) return;
    const m = e.data;
    if (m.type === 'response' && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || 'Falha'));
    } else if (m.type === 'event') {
      (listeners.get(m.event) || []).forEach((fn) => {
        try { fn(m.data); } catch (err) { console.error('[Opex Fideliza]', err); }
      });
    }
  });

  OA.bridge = {
    call(action, payload, timeoutMs = 45000) {
      return new Promise((resolve, reject) => {
        const id = 'r' + ++seq + '_' + Date.now();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Tempo esgotado ao falar com o WhatsApp'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        window.postMessage({ source: SRC_OUT, id, action, payload }, location.origin);
      });
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
  };

  const U = (OA.util = {});

  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  U.rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

  U.esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.digits = (s) => String(s || '').replace(/\D/g, '');

  // Normaliza telefone. Números de 10–11 dígitos recebem o DDI padrão (55 = Brasil).
  U.normalizePhone = (raw, ddi = '55') => {
    let d = U.digits(raw).replace(/^0+/, '');
    if (!d) return '';
    if (ddi && (d.length === 10 || d.length === 11) && !d.startsWith(ddi)) d = ddi + d;
    return d.length >= 10 && d.length <= 15 ? d : '';
  };

  U.formatPhone = (d) => {
    d = U.digits(d);
    const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : d ? '+' + d : '';
  };

  U.money = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  U.fmtDateTime = (ts) =>
    ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

  U.relTime = (ts) => {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const abs = Math.abs(diff);
    const min = 60000, h = 60 * min, d = 24 * h;
    const fut = diff < 0;
    let v;
    if (abs < min) v = 'agora';
    else if (abs < h) v = Math.round(abs / min) + ' min';
    else if (abs < d) v = Math.round(abs / h) + ' h';
    else v = Math.round(abs / d) + ' d';
    return v === 'agora' ? v : fut ? 'em ' + v : 'há ' + v;
  };

  // Valor para <input type="datetime-local"> no fuso local.
  U.toLocalInput = (ts) => {
    const d = new Date(ts || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  U.fromLocalInput = (v) => (v ? new Date(v).getTime() : 0);

  U.today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  U.greeting = () => {
    const h = new Date().getHours();
    return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  };

  // Variáveis: {nome} {primeiro_nome} {telefone} {saudacao} {data}
  // Variações (anti-spam): {Oi|Olá|E aí} → escolhe uma aleatória por envio.
  U.renderText = (text, contact = {}) => {
    const name = String(contact.name || '').trim();
    const first = name.split(/\s+/)[0] || '';
    const vars = {
      nome: name,
      primeiro_nome: first,
      telefone: U.formatPhone(contact.phone || ''),
      saudacao: U.greeting(),
      data: new Date().toLocaleDateString('pt-BR'),
    };
    let out = String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m));
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (m, opts) => {
      const list = opts.split('|');
      return list[Math.floor(Math.random() * list.length)];
    });
    return out.replace(/[ \t]+\n/g, '\n').trim();
  };

  // CSV simples: aceita vírgula ou ponto e vírgula, aspas e cabeçalho opcional.
  U.parseCSV = (text) => {
    const firstLine = String(text).split(/\r?\n/)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
  };

  // Lê contatos (nome + telefone) de CSV ou de uma lista colada.
  U.parseAudience = (text, ddi) => {
    const rows = U.parseCSV(text);
    const out = [];
    const seen = new Set();
    for (const r0 of rows) {
      const r = r0.flatMap((c) => c.split(/[;\t|]/)).map((c) => c.trim()).filter(Boolean);
      let phone = '', name = '';
      for (const c of r) {
        const n = U.normalizePhone(c, ddi);
        if (!phone && n && U.digits(c).length >= 8 && /^[\d\s()+\-.]+$/.test(c)) phone = n;
        else if (!name && /[a-zA-ZÀ-ÿ]/.test(c)) name = c;
      }
      if (phone && !seen.has(phone)) { seen.add(phone); out.push({ phone, name }); }
    }
    return out;
  };

  // ---------------- XLSX mínimo (sem bibliotecas) ----------------
  const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const xe = (v) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colL = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  U.xlsxBuild = (rows, sheet = 'Planilha') => {
    const enc = new TextEncoder();
    const sd = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${colL(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`).join('')}</row>`).join('');
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xe(sheet).slice(0, 30)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sd}</sheetData></worksheet>`],
    ];
    const parts = []; const central = []; let off = 0;
    const u16 = (n) => [n & 255, (n >> 8) & 255]; const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    for (const [name, text] of files) {
      const nb = enc.encode(name); const data = enc.encode(text); const crc = crc32(data);
      const lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)]);
      parts.push(lh, nb, data);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
      off += lh.length + nb.length + data.length;
    }
    const cs = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cs), ...u32(off), ...u16(0)]);
    return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };
  U.downloadBlob = (filename, blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const inflate = async (bytes) => {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  };
  U.xlsxParse = async (buf) => {
    const b = new Uint8Array(buf); const dv = new DataView(buf);
    let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Arquivo .xlsx inválido');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const dec = new TextDecoder(); const ent = {};
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      ent[dec.decode(b.subarray(p + 46, p + 46 + nl))] = { method, csz, lo };
      p += 46 + nl + el + cl;
    }
    const read = async (name) => {
      const f = ent[name]; if (!f) return null;
      const nl = dv.getUint16(f.lo + 26, true), el = dv.getUint16(f.lo + 28, true);
      const raw = b.subarray(f.lo + 30 + nl + el, f.lo + 30 + nl + el + f.csz);
      return dec.decode(f.method === 8 ? await inflate(raw) : raw);
    };
    const sheetName = Object.keys(ent).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
    if (!sheetName) throw new Error('Planilha vazia');
    const parse = (x) => new DOMParser().parseFromString(x, 'application/xml');
    const ss = [];
    const sx = await read('xl/sharedStrings.xml');
    if (sx) parse(sx).querySelectorAll('si').forEach((si) => ss.push([...si.querySelectorAll('t')].map((t) => t.textContent).join('')));
    const doc = parse(await read(sheetName));
    const rows = [];
    doc.querySelectorAll('row').forEach((row) => {
      const r = [];
      row.querySelectorAll('c').forEach((c) => {
        const m = /^([A-Z]+)/.exec(c.getAttribute('r') || ''); let ci = 0;
        if (m) for (const ch of m[1]) ci = ci * 26 + ch.charCodeAt(0) - 64;
        ci = Math.max(0, ci - 1);
        const t = c.getAttribute('t'); const v = c.querySelector('v');
        let val = '';
        if (t === 's') val = ss[Number(v && v.textContent)] || '';
        else if (t === 'inlineStr') val = [...c.querySelectorAll('t')].map((x) => x.textContent).join('');
        else if (v) { val = v.textContent; if (/e\+?\d+/i.test(val) && Number.isFinite(Number(val))) val = Number(val).toFixed(0); }
        r[ci] = val;
      });
      rows.push(Array.from(r, (x) => x || ''));
    });
    return rows;
  };

  U.download = (filename, content, type = 'application/json') => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  U.readFile = (file, as = 'text') =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      as === 'dataurl' ? fr.readAsDataURL(file) : fr.readAsText(file);
    });

  U.notify = (title, message) => {
    try { chrome.runtime.sendMessage({ type: 'notify', title, message }); } catch (_) {}
  };
})();
