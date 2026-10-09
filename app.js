'use strict';
/* =====================================================================
   QillqaPOS — PWA de punto de venta conectada a Google Sheets
   ===================================================================== */

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const fmt = n => num(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = n => Number.isInteger(num(n)) ? String(num(n)) : String(r3(n));
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const sum = (a, f) => a.reduce((s, x) => s + num(f(x)), 0);
const debounce = (f, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const fechaHora = iso => new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hora = iso => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const $m = n => `${S.cfg.moneda || 'S/'} ${fmt(n)}`;

const ICONS = {
  cart: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><path d="M7 14h10v7H7z"/>',
  logout: '<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M3 21v-5h5M21 3v5h-5"/>',
  wa: '<path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6z"/>',
  down: '<path d="M12 4v12M6 12l6 6 6-6M5 21h14"/>'
};
const ic = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

const METODOS = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito (fiado)' };
const COMPROBANTES = { ticket: 'Ticket', boleta: 'Boleta', factura: 'Factura' };
const UNIDADES = ['unidad', 'kg', 'gramo', 'litro', 'caja', 'paquete', 'docena', 'bolsa', 'botella'];
const MARCA_CREADORA = '<footer class="creator-mark">Creado por <strong>Lazo &amp; Nexora Studio</strong></footer>';

/* ---------- Estado ---------- */
const S = {
  cfg: {}, productos: [], clientes: [], usuarios: [], user: null,
  view: 'venta', cart: [], cliente: null, descuento: 0, cat: 'Todas', q: '',
  invQ: '', invF: 'todos', cliQ: '', rep: null, repPreset: 'hoy', repD1: '', repD2: '', caja: null,
  pendientes: 0, errores: [], online: navigator.onLine, sincronizando: false
};
let CONN = null;
try { CONN = JSON.parse(localStorage.getItem('qp_conn') || 'null'); } catch (e) {}
try { S.user = JSON.parse(localStorage.getItem('qp_user') || 'null'); } catch (e) {}
let deferredInstall = null;

/* ---------- Almacenamiento local (IndexedDB) ---------- */
const idb = (() => {
  let db;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('qillqapos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('kv', mode); const rq = fn(t.objectStore('kv'));
      t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error);
    });
  };
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)) };
})();
const guardarCache = () => idb.set('cache', { cfg: S.cfg, productos: S.productos, clientes: S.clientes, usuarios: S.usuarios }).catch(() => {});

/* ---------- API (Apps Script) ---------- */
async function api(action, data = {}, timeout = 30000) {
  if (!CONN) throw Object.assign(new Error('Aún no conectas la hoja de Google'), { noconn: true });
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(CONN.url, { method: 'POST', body: JSON.stringify({ token: CONN.token, action, user: S.user ? S.user.usuario : '', data }), signal: ctl.signal });
  } catch (e) { throw Object.assign(new Error('Sin conexión con el servidor'), { network: true }); }
  finally { clearTimeout(to); }
  let json;
  try { json = await res.json(); } catch (e) { throw Object.assign(new Error('Respuesta inválida. Revisa la URL y que el acceso sea "Cualquier persona".'), { network: true }); }
  if (!json.ok) throw Object.assign(new Error(json.error || 'Error del servidor'), { auth: json.code === 'auth' });
  return json.data;
}

/* Cola de operaciones que se pueden hacer sin internet */
const OFFLINE_OK = ['venta', 'gasto', 'abono'];
async function encolar(action, data) {
  const q = (await idb.get('queue')) || []; q.push({ action, data, t: Date.now() });
  await idb.set('queue', q); S.pendientes = q.length; pintarEstado();
}
let flushing = false;
async function vaciarCola() {
  if (flushing || !CONN) return; flushing = true;
  try {
    const q = (await idb.get('queue')) || [];
    if (!q.length) { S.pendientes = 0; return; }
    const resto = []; const errs = (await idb.get('errores')) || [];
    for (let i = 0; i < q.length; i++) {
      try { await api(q[i].action, q[i].data); }
      catch (e) {
        if (e.network) { resto.push(...q.slice(i)); break; }
        errs.push({ ...q[i], error: e.message });
      }
    }
    await idb.set('queue', resto); await idb.set('errores', errs);
    S.pendientes = resto.length; S.errores = errs;
    if (resto.length < q.length) toast(`${q.length - resto.length} operación(es) sincronizada(s)`, 'ok');
  } finally { flushing = false; pintarEstado(); }
}

async function sincronizar(silencioso = true) {
  if (!CONN) return false;
  S.sincronizando = true; pintarEstado();
  try {
    await vaciarCola();
    const d = await api('sync');
    S.cfg = d.config; S.productos = d.productos; S.clientes = d.clientes; S.usuarios = d.usuarios;
    // Si aún quedan ventas en cola, refleja su efecto en el stock local.
    const q = (await idb.get('queue')) || [];
    q.filter(x => x.action === 'venta').forEach(x => x.data.venta.items.forEach(it => { const p = S.productos.find(p => p.id === it.producto_id); if (p) p.stock = r3(num(p.stock) - num(it.cantidad)); }));
    await guardarCache(); S.online = true;
    if (!silencioso) toast('Datos actualizados', 'ok');
    return true;
  } catch (e) {
    if (e.auth) { toast('El token ya no es válido. Vuelve a conectar la hoja.', 'err'); }
    else if (!silencioso) toast(e.message, 'err');
    S.online = !e.network && S.online;
    return false;
  } finally { S.sincronizando = false; pintarEstado(); }
}

/* ---------- Interfaz base: toasts y modales ---------- */
function toast(msg, tipo = '') {
  const el = document.createElement('div'); el.className = 'toast ' + tipo; el.textContent = msg;
  $('#toasts').append(el); setTimeout(() => el.classList.add('out'), 2800); setTimeout(() => el.remove(), 3200);
}
function modal(html, { cls = '', onClose, fijo = false } = {}) {
  const el = document.createElement('div'); el.className = 'overlay';
  el.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  $('#modal-root').append(el);
  const close = () => { el.remove(); if (onClose) onClose(); };
  if (!fijo) el.addEventListener('mousedown', e => { if (e.target === el) close(); });
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  return { el, close, q: s => $(s, el), qa: s => $$(s, el) };
}
function preguntar({ titulo, etiqueta, valor = '', tipo = 'text', ok = 'Aceptar', nota = '' }) {
  return new Promise(res => {
    const m = modal(`<h2>${esc(titulo)}</h2><label class="f"><span>${esc(etiqueta || '')}</span><input id="pq" type="${tipo}" ${tipo === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${esc(valor)}"></label>${nota ? `<p class="muted sm">${nota}</p>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn line grow" data-close>Cancelar</button><button class="btn grow" id="pok">${esc(ok)}</button></div>`, { onClose: () => res(null) });
    const inp = m.q('#pq'); setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const fin = () => { const v = inp.value; m.el.remove(); res(v); };
    m.q('#pok').onclick = fin; inp.onkeydown = e => { if (e.key === 'Enter') fin(); };
  });
}
function confirmar(msg, ok = 'Confirmar', peligro = false) {
  return new Promise(res => {
    const m = modal(`<h2>${esc(msg)}</h2><div class="row" style="margin-top:14px"><button class="btn line grow" data-close>Cancelar</button><button class="btn ${peligro ? 'bad' : ''} grow" id="cok">${esc(ok)}</button></div>`, { onClose: () => res(false) });
    m.q('#cok').onclick = () => { m.el.remove(); res(true); };
  });
}
function descargar(nombre, texto, tipo = 'text/csv;charset=utf-8') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + texto], { type: tipo })); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Imágenes (cámara / archivo) ---------- */
function reducirImagen(file, max = 480) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => rej(new Error('No se pudo leer la imagen')); img.src = url;
  });
}
const b64 = dataUrl => dataUrl.split(',')[1];

/* ---------- Escáner de códigos de barras / QR con la cámara ---------- */
let zxingPromise = null;
function cargarZXing() {
  if (window.ZXing) return Promise.resolve();
  return zxingPromise || (zxingPromise = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    s.onload = res; s.onerror = () => { zxingPromise = null; rej(new Error('No se pudo cargar el lector (requiere internet la primera vez)')); }; document.head.append(s);
  }));
}
function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); o.frequency.value = 1100; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); a.close(); }, 90); } catch (e) {} if (navigator.vibrate) navigator.vibrate(40); }

async function abrirEscaner(onCode, { continuo = false, titulo = 'Escanear código' } = {}) {
  const m = modal(`<div class="row between"><h2 style="margin:0">${esc(titulo)}</h2><button class="icon-btn plain" data-close aria-label="Cerrar">${ic('x')}</button></div>
    <div class="scanwrap" style="margin:12px 0"><video playsinline muted></video><div class="frame"></div></div>
    <p class="muted sm" id="scanmsg">Apunta al código de barras o QR…</p>
    <div class="row"><input id="manual" type="text" inputmode="numeric" placeholder="O escribe el código" class="grow"><button class="btn" id="manualok">Usar</button></div>`, { cls: 'wide', fijo: true });
  const video = m.q('video'); const msg = m.q('#scanmsg');
  let stream = null, timer = null, reader = null, cerrado = false, ultimo = '', ultimoT = 0;
  const limpiar = () => { cerrado = true; clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); if (reader) { try { reader.reset(); } catch (e) {} } };
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { limpiar(); obs.disconnect(); } }); obs.observe($('#modal-root'), { childList: true });
  const recibir = code => {
    const ahora = Date.now(); if (code === ultimo && ahora - ultimoT < 1800) return; ultimo = code; ultimoT = ahora;
    beep(); onCode(code);
    if (!continuo) { limpiar(); m.close(); } else msg.textContent = 'Último: ' + code;
  };
  m.q('#manualok').onclick = () => { const v = m.q('#manual').value.trim(); if (v) { onCode(v); if (!continuo) { limpiar(); m.close(); } else m.q('#manual').value = ''; } };
  m.q('#manual').onkeydown = e => { if (e.key === 'Enter') m.q('#manualok').click(); };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'Este navegador no permite usar la cámara aquí (se necesita HTTPS). Escribe el código.'; return; }
  try {
    if ('BarcodeDetector' in window) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream; await video.play();
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] });
      timer = setInterval(async () => {
        if (cerrado || video.readyState < 2) return;
        try { const r = await det.detect(video); if (r.length) recibir(r[0].rawValue); } catch (e) {}
      }, 220);
    } else {
      await cargarZXing();
      reader = new ZXing.BrowserMultiFormatReader();
      await reader.decodeFromVideoDevice(null, video, (result) => { if (result && !cerrado) recibir(result.getText()); });
    }
  } catch (e) {
    msg.textContent = e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en el navegador o escribe el código.' : (e.message || 'No se pudo abrir la cámara');
  }
}

/* ---------- Cálculos ---------- */
function calcVenta(items, descuento, pagos) {
  const subtotal = r2(sum(items, i => num(i.cantidad) * num(i.precio)));
  const desc = r2(Math.min(Math.max(num(descuento), 0), subtotal));
  const total = r2(subtotal - desc);
  const pct = num(S.cfg.igv_pct) || 18;
  const igv = S.cfg.igv_activo === 'si' ? r2(total - total / (1 + pct / 100)) : 0;
  const pagado = r2(sum(pagos || [], p => p.monto));
  return { subtotal, descuento: desc, total, igv, pagado, vuelto: Math.max(0, r2(pagado - total)) };
}
const totalesCarrito = () => calcVenta(S.cart, S.descuento, []);
async function sha256(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

/* ---------- Pantallas de acceso ---------- */
function pantallaConexion(err = '') {
  $('#app').innerHTML = `<div class="center"><div class="auth stack">
    <div class="brand"><img src="icons/icon-192.png" alt="">QillqaPOS</div>
    <p class="muted" style="text-align:center;margin:0">Conecta tu Google Sheets para empezar.</p>
    ${err ? `<div class="banner" style="background:var(--bad-bg)">${esc(err)}</div>` : ''}
    <label class="f"><span>Código de conexión</span><textarea id="cc" placeholder="Pégalo desde el menú QillqaPOS de tu hoja"></textarea></label>
    <details><summary class="muted sm" style="cursor:pointer">Prefiero pegar la URL y el token por separado</summary>
      <div class="stack" style="margin-top:10px"><label class="f"><span>URL de la aplicación web</span><input id="cu" type="text" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="f"><span>Token</span><input id="ct" type="text"></label></div></details>
    <button class="btn aji lg block" id="conectar">Conectar hoja</button>${MARCA_CREADORA}</div></div>`;
  $('#conectar').onclick = async () => {
    let url = $('#cu').value.trim(), token = $('#ct').value.trim();
    const cod = $('#cc').value.trim();
    if (cod) { try { const j = JSON.parse(atob(cod)); url = j.u || url; token = j.t || token; } catch (e) { return pantallaConexion('El código no es válido. Cópialo completo.'); } }
    if (!/^https:\/\/script\.google\.com\//.test(url) || !token) return pantallaConexion('Falta la URL de la aplicación web o el token.');
    CONN = { url, token }; localStorage.setItem('qp_conn', JSON.stringify(CONN));
    $('#conectar').disabled = true; $('#conectar').textContent = 'Conectando…';
    const ok = await sincronizar(true);
    if (!ok) { CONN = null; localStorage.removeItem('qp_conn'); return pantallaConexion('No se pudo conectar. Revisa que la implementación permita acceso a "Cualquier persona" y que ejecutaste la configuración inicial.'); }
    render();
  };
}
function pantallaLogin() {
  let pin = '';
  const us = S.usuarios;
  $('#app').innerHTML = `<div class="center"><div class="auth stack">
    <div class="brand"><img src="icons/icon-192.png" alt="">${esc(S.cfg.negocio || 'QillqaPOS')}</div>
    ${us.length ? `<label class="f"><span>Usuario</span><select id="lu">${us.map(u => `<option value="${esc(u.usuario)}">${esc(u.usuario)} (${esc(u.rol)})</option>`).join('')}</select></label>
    <div class="dots" id="dots"></div>
    <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="del" aria-label="Borrar">⌫</button><button data-k="0">0</button><button data-k="ok" style="background:var(--aji);color:#241a00">Entrar</button></div>`
      : `<div class="empty">No hay usuarios guardados. Conéctate a internet para sincronizar.</div><button class="btn block" id="reint">Reintentar</button>`}
    <button class="btn-ghost block" id="desco">Cambiar de hoja de Google</button>${MARCA_CREADORA}</div></div>`;
  const dots = () => { const d = $('#dots'); if (d) d.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join(''); };
  dots();
  const entrar = async () => {
    const u = us.find(x => x.usuario === $('#lu').value);
    if (!crypto.subtle) return toast('Se necesita HTTPS para iniciar sesión', 'err');
    if (u && await sha256(`${u.usuario}:${pin}:qillqa`) === u.hash) { S.user = { usuario: u.usuario, rol: u.rol }; localStorage.setItem('qp_user', JSON.stringify(S.user)); render(); vaciarCola(); }
    else { pin = ''; dots(); toast('PIN incorrecto', 'err'); }
  };
  $$('.pinpad button').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === 'del') pin = pin.slice(0, -1); else if (k === 'ok') return entrar(); else if (pin.length < 8) pin += k;
    dots();
  });
  const r = $('#reint'); if (r) r.onclick = async () => { await sincronizar(false); pantallaLogin(); };
  $('#desco').onclick = async () => { if (await confirmar('¿Desconectar esta hoja de este dispositivo?', 'Desconectar', true)) { localStorage.removeItem('qp_conn'); localStorage.removeItem('qp_user'); CONN = null; S.user = null; render(); } };
}

/* ---------- Estructura general ---------- */
const TABS = [['venta', 'Caja de venta', 'Caja', 'cart'], ['inventario', 'Inventario', 'Inventario', 'box'], ['clientes', 'Clientes', 'Clientes', 'users'], ['reportes', 'Reportes y cierre', 'Reportes', 'chart'], ['ajustes', 'Configuración', 'Ajustes', 'gear']];
const tabsPermitidos = () => S.user.rol === 'admin' ? TABS : TABS.filter(t => ['venta', 'clientes', 'reportes'].includes(t[0]));

function render() {
  if (!CONN) return pantallaConexion();
  if (!S.user) return pantallaLogin();
  const tabs = tabsPermitidos(); if (!tabs.some(t => t[0] === S.view)) S.view = 'venta';
  const tit = TABS.find(t => t[0] === S.view)[1];
  $('#app').innerHTML = `<div class="shell">
    <nav class="side"><div class="brand"><img src="icons/icon-192.png" alt="">QillqaPOS</div>
      ${tabs.map(t => `<button class="navb ${S.view === t[0] ? 'on' : ''}" data-act="ir" data-v="${t[0]}">${ic(t[3])}${t[1]}</button>`).join('')}
      <div class="grow"></div><div class="sm" style="color:#C9D3EA;padding:8px">${esc(S.user.usuario)} · ${esc(S.user.rol)}</div></nav>
    <div class="main"><header class="top"><h1>${tit}</h1><span id="estado"></span><div class="grow"></div>
      <button class="icon-btn" data-act="sync" aria-label="Sincronizar">${ic('refresh')}</button>
      <button class="icon-btn" data-act="salir" aria-label="Cerrar sesión">${ic('logout')}</button></header>
      <main class="view" id="view"></main></div></div>
    <nav class="tabs">${tabs.map(t => `<button class="navb ${S.view === t[0] ? 'on' : ''}" data-act="ir" data-v="${t[0]}">${ic(t[3], 22)}${t[2]}</button>`).join('')}</nav>`;
  pintarEstado(); renderVista();
}
function pintarEstado() {
  const el = $('#estado'); if (!el) return;
  el.innerHTML = S.sincronizando ? '<span class="pill">Sincronizando…</span>'
    : !navigator.onLine ? `<span class="pill warn">Sin conexión${S.pendientes ? ' · ' + S.pendientes + ' pendiente(s)' : ''}</span>`
    : S.pendientes ? `<span class="pill warn">${S.pendientes} por enviar</span>` : '<span class="pill ok">En línea</span>';
}
function renderVista() {
  ({ venta: vistaVenta, inventario: vistaInventario, clientes: vistaClientes, reportes: vistaReportes, ajustes: vistaAjustes })[S.view]();
  $('#view').insertAdjacentHTML('beforeend', MARCA_CREADORA);
}

/* ---------- CAJA DE VENTA ---------- */
function vistaVenta() {
  $('#view').innerHTML = `<div class="pos"><section class="pos-left">
      <div class="searchbar"><input id="q" type="search" placeholder="Buscar producto o escanear código…" autocomplete="off" value="${esc(S.q)}">
      <button class="icon-btn" data-act="scan" aria-label="Escanear con la cámara">${ic('scan')}</button></div>
      <div class="chips" id="chips"></div><div class="pgrid" id="grid"></div></section>
      <aside class="cart" id="cart"></aside></div>
      <button class="cartbar" id="cartbar" data-act="abrir-cart"></button>`;
  const q = $('#q');
  q.oninput = () => { S.q = q.value; pintarGrid(); };
  q.onkeydown = e => {
    if (e.key !== 'Enter') return;
    const t = q.value.trim(); if (!t) return;
    const p = S.productos.find(p => String(p.codigo) === t) || (filtrarProductos().length === 1 ? filtrarProductos()[0] : null);
    if (p) { agregarAlCarrito(p); q.value = ''; S.q = ''; pintarGrid(); } else toast('Sin coincidencias para "' + t + '"', 'err');
  };
  pintarChips(); pintarGrid(); pintarCarrito();
}
function filtrarProductos() {
  const t = norm(S.q);
  return S.productos.filter(p => (S.cat === 'Todas' || p.categoria === S.cat) && (!t || norm(p.nombre).includes(t) || String(p.codigo).includes(S.q.trim())));
}
function pintarChips() {
  const cats = ['Todas', ...new Set(S.productos.map(p => p.categoria).filter(Boolean))].sort((a, b) => a === 'Todas' ? -1 : b === 'Todas' ? 1 : a.localeCompare(b));
  $('#chips').innerHTML = cats.map(c => `<button class="chip ${S.cat === c ? 'on' : ''}" data-act="cat" data-c="${esc(c)}">${esc(c)}</button>`).join('');
}
function pintarGrid() {
  const g = $('#grid'); if (!g) return;
  const lista = filtrarProductos().slice(0, 240);
  g.innerHTML = lista.length ? lista.map(p => {
    const bajo = num(p.stock) <= num(p.stock_min);
    return `<button class="prod" data-act="add" data-id="${esc(p.id)}"><div class="ph" ${p.foto ? `style="background-image:url('${esc(p.foto)}')"` : ''}>${p.foto ? '' : esc((p.nombre || '?')[0].toUpperCase())}</div>
      <div class="b"><div class="n">${esc(p.nombre)}</div><div class="s ${bajo ? 'low' : ''}">${qty(p.stock)} ${esc(p.unidad || '')}</div><div class="p num">${$m(p.precio)}</div></div></button>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1">${S.productos.length ? 'No hay productos con ese filtro.' : 'Aún no tienes productos. Ve a Inventario y agrega el primero.'}</div>`;
}
function agregarAlCarrito(p, c = 1) {
  const it = S.cart.find(i => i.producto_id === p.id);
  if (it) it.cantidad = r3(num(it.cantidad) + c);
  else S.cart.push({ producto_id: p.id, codigo: p.codigo, nombre: p.nombre, precio: num(p.precio), costo: num(p.costo), cantidad: c, unidad: p.unidad });
  pintarCarrito();
}
function pintarCarrito() {
  const el = $('#cart'); if (!el) return;
  const t = totalesCarrito(); const n = sum(S.cart, i => i.cantidad);
  el.innerHTML = `<div class="cart-h"><h3>Venta actual</h3><div class="row">${S.cart.length ? '<button class="btn-ghost" data-act="vaciar">Vaciar</button>' : ''}<button class="icon-btn plain only-mobile" data-act="cerrar-cart" aria-label="Cerrar">${ic('x')}</button></div></div>
    <div class="cart-items">${S.cart.length ? S.cart.map((i, ix) => `<div class="ci"><div class="n">${esc(i.nombre)}</div><div class="right num"><b>${$m(i.cantidad * i.precio)}</b></div>
      <div class="row"><div class="qty"><button data-act="menos" data-i="${ix}" aria-label="Menos">−</button><input type="number" step="any" inputmode="decimal" data-cant="${ix}" value="${qty(i.cantidad)}" aria-label="Cantidad"><button data-act="mas" data-i="${ix}" aria-label="Más">+</button></div>
      <button class="btn-ghost sm num" data-act="precio" data-i="${ix}">${$m(i.precio)} c/u ✎</button></div>
      <div class="right"><button class="btn-ghost" data-act="quitar" data-i="${ix}" aria-label="Quitar">${ic('x', 18)}</button></div></div>`).join('')
      : '<div class="empty">Toca un producto o escanea su código para agregarlo.</div>'}</div>
    <div class="cart-f"><div class="row between sm"><button class="btn-ghost" data-act="elegir-cliente">${S.cliente ? '👤 ' + esc(S.cliente.nombre) : '👤 Cliente: público general'}</button>
      <button class="btn-ghost" data-act="descuento">${S.descuento ? 'Descuento −' + $m(S.descuento) : 'Descuento'}</button></div>
      <div class="tot"><span>Total</span><span class="num">${$m(t.total)}</span></div>
      <button class="btn aji lg block" data-act="cobrar" ${S.cart.length ? '' : 'disabled'}>Cobrar</button></div>`;
  const cb = $('#cartbar');
  if (cb) { cb.classList.toggle('hide', !S.cart.length); cb.innerHTML = `<span>${ic('cart')} ${qty(n)} ítem(s)</span><span class="num">Cobrar ${$m(t.total)}</span>`; }
}
function limpiarVenta() { S.cart = []; S.cliente = null; S.descuento = 0; pintarCarrito(); }

function elegirCliente(alElegir) {
  const m = modal(`<h2>Cliente</h2><input id="cq" type="search" placeholder="Buscar por nombre o documento" autocomplete="off">
    <div class="list" id="cl" style="margin:12px 0;max-height:46vh;overflow:auto"></div>
    <div class="row"><button class="btn line grow" id="cpub">Público general</button><button class="btn grow" id="cnew">${ic('plus')} Nuevo</button></div>`);
  const pintar = () => {
    const t = norm(m.q('#cq').value);
    const l = S.clientes.filter(c => !t || norm(c.nombre).includes(t) || String(c.documento).includes(t)).slice(0, 40);
    m.q('#cl').innerHTML = l.map(c => `<button class="item" data-id="${esc(c.id)}"><div class="grow"><b>${esc(c.nombre)}</b><div class="muted sm">${esc(c.documento || 'Sin documento')}</div></div>${num(c.deuda) > 0 ? `<span class="pill bad">Debe ${$m(c.deuda)}</span>` : ''}</button>`).join('') || '<div class="empty">Sin resultados</div>';
  };
  pintar(); m.q('#cq').oninput = pintar;
  m.q('#cl').onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; S.cliente = S.clientes.find(c => c.id === b.dataset.id); m.close(); pintarCarrito(); alElegir && alElegir(); };
  m.q('#cpub').onclick = () => { S.cliente = null; m.close(); pintarCarrito(); alElegir && alElegir(); };
  m.q('#cnew').onclick = () => { m.close(); formCliente(null, c => { S.cliente = c; pintarCarrito(); alElegir && alElegir(); }); };
}

/* Cobro */
function abrirCobro() {
  if (!S.cart.length) return;
  const P = { comprobante: 'ticket', pagos: [] };
  const m = modal('<div id="cb"></div>', { cls: 'wide', fijo: true });
  const T = () => calcVenta(S.cart, S.descuento, P.pagos);
  const otros = i => r2(sum(P.pagos.filter((_, k) => k !== i), p => p.monto));
  const motivoBloqueo = () => {
    const t = T(); if (!P.pagos.length) return 'Elige cómo paga el cliente';
    if (r2(t.total - t.pagado) > 0.001) return 'Falta ' + $m(t.total - t.pagado);
    const ef = sum(P.pagos.filter(p => p.metodo === 'efectivo'), p => p.monto);
    if (t.vuelto > ef + 0.001) return 'El vuelto excede el efectivo recibido';
    if (P.pagos.some(p => p.metodo === 'credito' && num(p.monto) > 0) && !S.cliente) return 'Elige un cliente para vender a crédito';
    if (P.comprobante === 'factura' && !(S.cliente && String(S.cliente.documento).length === 11)) return 'La factura requiere un cliente con RUC';
    return '';
  };
  const upd = () => {
    const t = T(), falta = r2(t.total - t.pagado), b = motivoBloqueo();
    m.q('#resumen').innerHTML = `<div class="row between"><span class="muted">Recibido</span><b class="num">${$m(t.pagado)}</b></div>` +
      (falta > 0.001 ? `<div class="row between"><span class="muted">Falta</span><b class="num" style="color:var(--bad)">${$m(falta)}</b></div>` : `<div class="row between"><span class="muted">Vuelto</span><b class="num" style="color:var(--ok);font-size:22px">${$m(t.vuelto)}</b></div>`);
    const btn = m.q('#cobrar'); btn.disabled = !!b; btn.textContent = b || 'Confirmar cobro';
  };
  const draw = () => {
    const t = T();
    m.q('#cb').innerHTML = `<div class="row between"><h2 style="margin:0">Cobrar</h2><button class="icon-btn plain" data-close aria-label="Cerrar">${ic('x')}</button></div>
      <div class="big num" style="margin:8px 0 12px">${$m(t.total)}</div>
      <div class="seg" style="margin-bottom:10px">${Object.entries(COMPROBANTES).map(([k, v]) => `<button data-comp="${k}" class="${P.comprobante === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <button class="btn line block sm" data-cli style="margin-bottom:12px">👤 ${S.cliente ? esc(S.cliente.nombre) + (S.cliente.documento ? ' · ' + esc(S.cliente.documento) : '') : 'Cliente: público general'}</button>
      <div class="methods" style="margin-bottom:12px">${Object.entries(METODOS).map(([k, v]) => `<button data-met="${k}" class="m-${k}">${v}</button>`).join('')}</div>
      <div class="stack">${P.pagos.map((p, i) => {
        const exacto = r2(Math.max(0, t.total - otros(i)));
        return `<div class="payline m-${p.metodo}"><div class="row between"><b>${METODOS[p.metodo]}</b><button class="icon-btn plain" data-del="${i}" aria-label="Quitar">${ic('x', 18)}</button></div>
          <input type="number" step="any" inputmode="decimal" data-monto="${i}" value="${p.monto}" aria-label="Monto">
          ${p.metodo === 'efectivo' ? `<div class="row wrap"><button class="chip" data-quick="${i}:${exacto}">Exacto</button>${[10, 20, 50, 100, 200].filter(v => v > exacto).map(v => `<button class="chip" data-quick="${i}:${v}">${v}</button>`).join('')}</div>` : ''}
          ${p.metodo === 'yape' || p.metodo === 'plin' ? `<div class="row">${S.cfg[p.metodo + '_qr'] ? `<img class="qr" src="${esc(S.cfg[p.metodo + '_qr'])}" alt="QR ${p.metodo}">` : ''}<div class="sm muted">${S.cfg[p.metodo + '_numero'] ? 'Número: <b class="num">' + esc(S.cfg[p.metodo + '_numero']) + '</b>' : 'Configura tu número y QR en Configuración.'}</div></div>` : ''}
          ${['yape', 'plin', 'tarjeta', 'transferencia'].includes(p.metodo) ? `<input type="text" data-ref="${i}" placeholder="N° de operación (opcional)" value="${esc(p.ref)}">` : ''}</div>`;
      }).join('')}</div>
      <div class="card" style="margin:14px 0" id="resumen"></div>
      <button class="btn aji lg block" id="cobrar"></button>`;
    upd();
  };
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.comp) { P.comprobante = b.dataset.comp; draw(); }
    else if (b.dataset.met) { const falta = r2(Math.max(0, T().total - T().pagado)); P.pagos.push({ metodo: b.dataset.met, monto: falta, ref: '' }); draw(); }
    else if (b.dataset.del !== undefined) { P.pagos.splice(+b.dataset.del, 1); draw(); }
    else if (b.dataset.quick) { const [i, v] = b.dataset.quick.split(':'); P.pagos[+i].monto = +v; draw(); }
    else if (b.dataset.cli !== undefined) elegirCliente(draw);
    else if (b.id === 'cobrar') {
      b.disabled = true; b.textContent = 'Registrando…';
      const venta = {
        id: uid(), fecha: new Date().toISOString(), comprobante: P.comprobante,
        cliente: S.cliente ? { id: S.cliente.id, documento: S.cliente.documento, nombre: S.cliente.nombre, telefono: S.cliente.telefono } : null,
        items: S.cart.map(i => ({ producto_id: i.producto_id, nombre: i.nombre, cantidad: num(i.cantidad), precio: num(i.precio) })),
        descuento: S.descuento, pagos: P.pagos.filter(p => num(p.monto) > 0).map(p => ({ metodo: p.metodo, monto: r2(p.monto), ref: p.ref || '' })), notas: ''
      };
      try { const r = await registrarVenta(venta); m.el.remove(); limpiarVenta(); pintarGrid(); mostrarRecibo(r); }
      catch (err) { toast(err.message, 'err'); upd(); }
    }
  });
  m.el.addEventListener('input', e => {
    if (e.target.dataset.monto !== undefined) { P.pagos[+e.target.dataset.monto].monto = e.target.value; upd(); }
    if (e.target.dataset.ref !== undefined) P.pagos[+e.target.dataset.ref].ref = e.target.value;
  });
  draw();
}

async function registrarVenta(v) {
  const calc = calcVenta(v.items, v.descuento, v.pagos);
  let serie = 'PENDIENTE', pendiente = false;
  try {
    const r = await api('venta', { venta: v });
    serie = r.venta.serie_numero;
    (r.stocks || []).forEach(s => { const p = S.productos.find(p => p.id === s.id); if (p) p.stock = s.stock; });
    if (r.cliente) { const c = S.clientes.find(c => c.id === r.cliente.id); if (c) c.deuda = r.cliente.deuda; }
  } catch (e) {
    if (!e.network) throw e;
    await encolar('venta', { venta: v }); pendiente = true;
    v.items.forEach(it => { const p = S.productos.find(p => p.id === it.producto_id); if (p) p.stock = r3(num(p.stock) - num(it.cantidad)); });
    const cr = sum(v.pagos.filter(p => p.metodo === 'credito'), p => p.monto);
    if (cr && v.cliente) { const c = S.clientes.find(c => c.id === v.cliente.id); if (c) c.deuda = r2(num(c.deuda) + cr); }
  }
  guardarCache();
  return { v, calc, serie, pendiente, usuario: S.user.usuario };
}

function ticketHTML(r) {
  const c = S.cfg, v = r.v;
  return `<div class="ticket"><h4>${esc(c.negocio)}</h4><div class="c">${c.ruc ? 'RUC ' + esc(c.ruc) + '<br>' : ''}${esc(c.direccion)}${c.telefono ? '<br>Tel. ' + esc(c.telefono) : ''}</div><hr>
    <div class="c"><b>${esc(COMPROBANTES[v.comprobante].toUpperCase())} ${esc(r.serie)}</b></div>
    <div>Fecha: ${new Date(v.fecha).toLocaleString('es-PE')}</div>${v.cliente ? `<div>Cliente: ${esc(v.cliente.nombre)}${v.cliente.documento ? ' (' + esc(v.cliente.documento) + ')' : ''}</div>` : ''}<div>Atendió: ${esc(r.usuario)}</div><hr>
    <table>${v.items.map(i => `<tr><td colspan="2">${esc(i.nombre)}</td></tr><tr><td>${qty(i.cantidad)} x ${fmt(i.precio)}</td><td>${fmt(i.cantidad * i.precio)}</td></tr>`).join('')}</table><hr>
    <table><tr><td>Subtotal</td><td>${fmt(r.calc.subtotal)}</td></tr>${r.calc.descuento ? `<tr><td>Descuento</td><td>-${fmt(r.calc.descuento)}</td></tr>` : ''}${r.calc.igv ? `<tr><td>IGV incluido (${num(c.igv_pct) || 18}%)</td><td>${fmt(r.calc.igv)}</td></tr>` : ''}
    <tr><td><b>TOTAL ${esc(c.moneda)}</b></td><td><b>${fmt(r.calc.total)}</b></td></tr>
    ${v.pagos.map(p => `<tr><td>${esc(METODOS[p.metodo])}</td><td>${fmt(p.monto)}</td></tr>`).join('')}${r.calc.vuelto ? `<tr><td>Vuelto</td><td>${fmt(r.calc.vuelto)}</td></tr>` : ''}</table><hr>
    <div class="c">${esc(c.mensaje_ticket || '')}<br>Documento de control interno</div></div>`;
}
function imprimirTicket(r) { $('#print-area').innerHTML = ticketHTML(r); setTimeout(() => window.print(), 60); }
function compartirWhatsApp(r) {
  const v = r.v, c = S.cfg;
  const txt = `*${c.negocio}*\n${COMPROBANTES[v.comprobante]} ${r.serie}\n${new Date(v.fecha).toLocaleString('es-PE')}\n\n` +
    v.items.map(i => `• ${qty(i.cantidad)} x ${i.nombre} — ${$m(i.cantidad * i.precio)}`).join('\n') + `\n\n*Total: ${$m(r.calc.total)}*\n${c.mensaje_ticket || ''}`;
  const tel = v.cliente && v.cliente.telefono ? String(v.cliente.telefono).replace(/\D/g, '') : '';
  window.open(`https://wa.me/${tel ? (tel.length === 9 ? '51' + tel : tel) : ''}?text=${encodeURIComponent(txt)}`, '_blank');
}
function mostrarRecibo(r) {
  const m = modal(`<div class="stack" style="text-align:center"><div style="font-size:44px">✅</div><h2 style="margin:0">Venta registrada</h2>
    <div class="muted">${esc(COMPROBANTES[r.v.comprobante])} ${esc(r.serie)}</div><div class="big num">${$m(r.calc.total)}</div>
    ${r.calc.vuelto ? `<div class="pill ok" style="font-size:16px;padding:6px 14px">Vuelto ${$m(r.calc.vuelto)}</div>` : ''}
    ${r.pendiente ? '<div class="banner">Sin internet: la venta quedó guardada en este equipo y se enviará sola al reconectar. El número definitivo se asigna al sincronizar.</div>' : ''}
    <div class="row"><button class="btn line grow" id="rp">${ic('print')} Imprimir</button><button class="btn line grow" id="rw">${ic('wa')} WhatsApp</button></div>
    <button class="btn aji lg block" data-close>Nueva venta</button></div>`, { fijo: true });
  m.q('#rp').onclick = () => imprimirTicket(r); m.q('#rw').onclick = () => compartirWhatsApp(r);
}

/* Ejecuta una operación; si no hay internet y se permite, la deja en cola */
async function operacion(action, data) {
  try { return await api(action, data); }
  catch (e) { if (e.network && OFFLINE_OK.includes(action)) { await encolar(action, data); return { offline: true }; } throw e; }
}
function aplicarStocks(lista) { (lista || []).forEach(s => { const p = S.productos.find(p => p.id === s.id); if (p) p.stock = s.stock; }); }

/* ---------- INVENTARIO Y MERCADERÍA ---------- */
function vistaInventario() {
  const valor = sum(S.productos, p => num(p.stock) * num(p.costo));
  const bajos = S.productos.filter(p => num(p.stock) <= num(p.stock_min) && num(p.stock) > 0).length;
  const sin = S.productos.filter(p => num(p.stock) <= 0).length;
  $('#view').innerHTML = `<div class="stack">
    <div class="kpis"><div class="kpi"><div class="l">Productos</div><div class="v num">${S.productos.length}</div></div>
      <div class="kpi"><div class="l">Valor a costo</div><div class="v num">${$m(valor)}</div></div>
      <div class="kpi"><div class="l">Stock bajo</div><div class="v num" style="color:var(--aji-d)">${bajos}</div></div>
      <div class="kpi"><div class="l">Agotados</div><div class="v num" style="color:var(--bad)">${sin}</div></div></div>
    <div class="row wrap"><button class="btn aji grow" data-act="ingreso">${ic('down')} Ingresar mercadería</button><button class="btn grow" data-act="nuevo-prod">${ic('plus')} Producto</button><button class="btn line" data-act="csv-inv">CSV</button></div>
    <div class="searchbar" style="position:static;padding:0"><input id="iq" type="search" placeholder="Buscar en inventario…" value="${esc(S.invQ)}"><button class="icon-btn" data-act="scan-inv" aria-label="Escanear">${ic('scan')}</button></div>
    <div class="seg">${[['todos', 'Todos'], ['bajo', 'Stock bajo'], ['sin', 'Agotados']].map(([k, v]) => `<button data-act="invf" data-f="${k}" class="${S.invF === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="list" id="ilist"></div></div>`;
  $('#iq').oninput = e => { S.invQ = e.target.value; pintarInv(); };
  pintarInv();
}
function pintarInv() {
  const t = norm(S.invQ);
  const l = S.productos.filter(p => (!t || norm(p.nombre).includes(t) || String(p.codigo).includes(S.invQ.trim()) || norm(p.categoria).includes(t)) &&
    (S.invF === 'todos' || (S.invF === 'sin' ? num(p.stock) <= 0 : num(p.stock) <= num(p.stock_min) && num(p.stock) > 0))).slice(0, 300);
  $('#ilist').innerHTML = l.map(p => {
    const st = num(p.stock), cls = st <= 0 ? 'bad' : st <= num(p.stock_min) ? 'warn' : 'ok';
    const mg = num(p.precio) > 0 ? Math.round((num(p.precio) - num(p.costo)) / num(p.precio) * 100) : 0;
    return `<button class="item" data-act="edit-prod" data-id="${esc(p.id)}"><div class="thumb" ${p.foto ? `style="background-image:url('${esc(p.foto)}')"` : ''}>${p.foto ? '' : esc((p.nombre || '?')[0].toUpperCase())}</div>
      <div class="grow"><b>${esc(p.nombre)}</b><div class="muted sm">${esc(p.codigo || 'sin código')} · ${esc(p.categoria || 'sin categoría')}</div></div>
      <div class="right"><span class="pill ${cls}">${qty(st)} ${esc(p.unidad || '')}</span><div class="sm num" style="margin-top:4px"><b>${$m(p.precio)}</b> <span class="muted">· ${mg}%</span></div></div></button>`;
  }).join('') || '<div class="empty">No hay productos para mostrar.</div>';
}

function formProducto(p, alGuardar) {
  const nuevo = !p || !p.id; p = p || {};
  let foto64 = null;
  const cats = [...new Set(S.productos.map(x => x.categoria).filter(Boolean))];
  const m = modal(`<div class="row between"><h2 style="margin:0">${nuevo ? 'Nuevo producto' : 'Editar producto'}</h2><button class="icon-btn plain" data-close aria-label="Cerrar">${ic('x')}</button></div>
    <div class="stack" style="margin-top:12px">
    <div class="row"><div class="thumb" id="fprev" style="width:72px;height:72px;${p.foto ? `background-image:url('${esc(p.foto)}')` : ''}">${p.foto ? '' : ic('camera', 26)}</div>
      <label class="btn line sm">${ic('camera', 18)} Tomar / elegir foto<input id="ffoto" type="file" accept="image/*" capture="environment" hidden></label></div>
    <label class="f"><span>Código de barras</span><div class="row"><input id="fcod" type="text" inputmode="numeric" value="${esc(p.codigo || '')}" placeholder="Escanea o escribe"><button class="icon-btn" id="fscan" type="button" aria-label="Escanear">${ic('scan')}</button></div></label>
    <label class="f"><span>Nombre *</span><input id="fnom" type="text" value="${esc(p.nombre || '')}"></label>
    <div class="grid2"><label class="f"><span>Categoría</span><input id="fcat" type="text" list="cats" value="${esc(p.categoria || '')}"><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="f"><span>Unidad</span><select id="funi">${UNIDADES.map(u => `<option ${u === (p.unidad || 'unidad') ? 'selected' : ''}>${u}</option>`).join('')}</select></label></div>
    <div class="grid2"><label class="f"><span>Costo (${esc(S.cfg.moneda)})</span><input id="fcosto" type="number" step="any" inputmode="decimal" value="${p.costo ?? ''}"></label>
      <label class="f"><span>Precio de venta *</span><input id="fprecio" type="number" step="any" inputmode="decimal" value="${p.precio ?? ''}"></label></div>
    <div class="grid2">${nuevo ? `<label class="f"><span>Stock inicial</span><input id="fstock" type="number" step="any" inputmode="decimal" value="0"></label>` : `<label class="f"><span>Stock actual</span><div class="row"><b class="num grow">${qty(p.stock)}</b><button class="btn line sm" type="button" id="fajuste">Ajustar</button></div></label>`}
      <label class="f"><span>Stock mínimo (alerta)</span><input id="fmin" type="number" step="any" inputmode="decimal" value="${p.stock_min ?? 0}"></label></div>
    <label class="f"><span>Proveedor</span><input id="fprov" type="text" value="${esc(p.proveedor || '')}"></label>
    <div class="row">${nuevo ? '' : '<button class="btn line bad" style="color:#fff" id="fdel">Eliminar</button>'}<button class="btn grow" id="fsave">Guardar</button></div></div>`, { cls: 'wide', fijo: true });
  m.q('#fscan').onclick = () => abrirEscaner(c => { m.q('#fcod').value = c; });
  m.q('#ffoto').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = await reducirImagen(f); foto64 = b64(d); const pr = m.q('#fprev'); pr.style.backgroundImage = `url('${d}')`; pr.innerHTML = ''; } catch (err) { toast(err.message, 'err'); }
  };
  if (!nuevo) {
    m.q('#fajuste').onclick = async () => {
      const v = await preguntar({ titulo: 'Ajustar stock', etiqueta: 'Nuevo stock real', valor: qty(p.stock), tipo: 'number', ok: 'Ajustar' }); if (v === null || v === '') return;
      const mot = await preguntar({ titulo: 'Motivo del ajuste', etiqueta: 'Ej. conteo físico, merma, vencido', valor: 'Conteo físico' }); if (mot === null) return;
      try { const r = await api('ajuste', { producto_id: p.id, stock_nuevo: num(v), motivo: mot }); aplicarStocks([r]); guardarCache(); toast('Stock ajustado', 'ok'); m.close(); renderVista(); } catch (e) { toast(e.message, 'err'); }
    };
    m.q('#fdel').onclick = async () => { if (!(await confirmar('¿Eliminar "' + p.nombre + '"? Se conserva el historial de ventas.', 'Eliminar', true))) return;
      try { await api('producto_eliminar', { id: p.id }); S.productos = S.productos.filter(x => x.id !== p.id); guardarCache(); m.close(); renderVista(); toast('Producto eliminado', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  }
  m.q('#fsave').onclick = async () => {
    const prod = { id: p.id, codigo: m.q('#fcod').value.trim(), nombre: m.q('#fnom').value.trim(), categoria: m.q('#fcat').value.trim(), unidad: m.q('#funi').value,
      costo: num(m.q('#fcosto').value), precio: num(m.q('#fprecio').value), stock_min: num(m.q('#fmin').value), proveedor: m.q('#fprov').value.trim(), stock: nuevo ? num(m.q('#fstock').value) : undefined };
    if (!prod.nombre) return toast('Escribe el nombre', 'err');
    if (!(prod.precio > 0)) return toast('Indica el precio de venta', 'err');
    const b = m.q('#fsave'); b.disabled = true; b.textContent = 'Guardando…';
    try {
      const r = await api('producto_guardar', { producto: prod, foto_b64: foto64 }, 60000);
      const i = S.productos.findIndex(x => x.id === r.id); if (i >= 0) S.productos[i] = r; else S.productos.push(r);
      guardarCache(); m.close(); toast('Producto guardado', 'ok'); if (alGuardar) alGuardar(r); else renderVista();
    } catch (e) { toast(e.message, 'err'); b.disabled = false; b.textContent = 'Guardar'; }
  };
}

function formIngreso() {
  const L = []; // {p, cantidad, costo, precio}
  const m = modal(`<div class="row between"><h2 style="margin:0">Ingreso de mercadería</h2><button class="icon-btn plain" data-close aria-label="Cerrar">${ic('x')}</button></div>
    <div class="stack" style="margin-top:12px">
    <div class="grid2"><label class="f"><span>Proveedor</span><input id="iprov" type="text"></label><label class="f"><span>Factura / guía (ref.)</span><input id="iref" type="text"></label></div>
    <div class="row"><input id="isq" type="search" class="grow" placeholder="Buscar producto para agregar…" autocomplete="off"><button class="icon-btn" id="isc" aria-label="Escanear">${ic('scan')}</button></div>
    <div class="list" id="isres"></div><div id="ilines" class="stack"></div>
    <div class="row between"><span class="muted">Total compra</span><b class="num" id="itot"></b></div>
    <button class="btn aji lg block" id="iok">Registrar ingreso</button></div>`, { cls: 'wide', fijo: true });
  const agregar = p => { const l = L.find(x => x.p.id === p.id); if (l) l.cantidad = num(l.cantidad) + 1; else L.push({ p, cantidad: 1, costo: num(p.costo), precio: num(p.precio) }); m.q('#isq').value = ''; m.q('#isres').innerHTML = ''; lineas(); };
  const lineas = () => {
    m.q('#ilines').innerHTML = L.map((l, i) => `<div class="payline"><div class="row between"><b>${esc(l.p.nombre)}</b><span class="muted sm">stock ${qty(l.p.stock)}</span><button class="icon-btn plain" data-rm="${i}" aria-label="Quitar">${ic('x', 18)}</button></div>
      <div class="grid3"><label class="f"><span>Cantidad</span><input type="number" step="any" inputmode="decimal" data-f="cantidad" data-i="${i}" value="${l.cantidad}"></label>
      <label class="f"><span>Costo unit.</span><input type="number" step="any" inputmode="decimal" data-f="costo" data-i="${i}" value="${l.costo}"></label>
      <label class="f"><span>Precio venta</span><input type="number" step="any" inputmode="decimal" data-f="precio" data-i="${i}" value="${l.precio}"></label></div></div>`).join('') || '<div class="empty">Busca o escanea los productos que llegaron.</div>';
    tot();
  };
  const tot = () => { m.q('#itot').textContent = $m(sum(L, l => num(l.cantidad) * num(l.costo))); };
  m.q('#isq').oninput = e => {
    const t = norm(e.target.value); if (!t) { m.q('#isres').innerHTML = ''; return; }
    const l = S.productos.filter(p => norm(p.nombre).includes(t) || String(p.codigo).includes(e.target.value.trim())).slice(0, 6);
    m.q('#isres').innerHTML = l.map(p => `<button class="item" data-add="${esc(p.id)}"><div class="grow"><b>${esc(p.nombre)}</b><div class="muted sm">${esc(p.codigo || '')}</div></div><span class="pill">${qty(p.stock)}</span></button>`).join('') +
      `<button class="item" data-new="1">${ic('plus')} Crear producto nuevo</button>`;
  };
  const porCodigo = async c => {
    const p = S.productos.find(p => String(p.codigo) === String(c));
    if (p) return agregar(p);
    if (await confirmar('El código ' + c + ' no está registrado. ¿Crear el producto?', 'Crear')) formProducto({ codigo: c }, r => agregar(r));
  };
  m.q('#isc').onclick = () => abrirEscaner(porCodigo, { continuo: true, titulo: 'Escanear mercadería' });
  m.el.addEventListener('click', e => {
    const a = e.target.closest('[data-add]'), n = e.target.closest('[data-new]'), r = e.target.closest('[data-rm]');
    if (a) agregar(S.productos.find(p => p.id === a.dataset.add));
    if (n) formProducto({ nombre: m.q('#isq').value }, x => agregar(x));
    if (r) { L.splice(+r.dataset.rm, 1); lineas(); }
  });
  m.el.addEventListener('input', e => { const f = e.target.dataset.f; if (f) { L[+e.target.dataset.i][f] = e.target.value; tot(); } });
  m.q('#iok').onclick = async () => {
    if (!L.length) return toast('Agrega al menos un producto', 'err');
    if (L.some(l => !(num(l.cantidad) > 0))) return toast('Revisa las cantidades', 'err');
    const b = m.q('#iok'); b.disabled = true; b.textContent = 'Registrando…';
    try {
      const r = await api('ingreso', { proveedor: m.q('#iprov').value.trim(), referencia: m.q('#iref').value.trim(), items: L.map(l => ({ producto_id: l.p.id, cantidad: num(l.cantidad), costo: num(l.costo), precio: num(l.precio) })) }, 60000);
      r.productos.forEach(x => { const p = S.productos.find(p => p.id === x.id); if (p) { p.stock = x.stock; p.costo = x.costo; p.precio = x.precio; } });
      guardarCache(); m.close(); toast('Mercadería registrada en Google Sheets', 'ok'); renderVista();
    } catch (e) { toast(e.message, 'err'); b.disabled = false; b.textContent = 'Registrar ingreso'; }
  };
  lineas();
}

/* ---------- CLIENTES ---------- */
function vistaClientes() {
  const deuda = sum(S.clientes, c => c.deuda);
  $('#view').innerHTML = `<div class="stack"><div class="kpis"><div class="kpi"><div class="l">Clientes</div><div class="v num">${S.clientes.length}</div></div>
    <div class="kpi"><div class="l">Por cobrar (fiados)</div><div class="v num" style="color:var(--bad)">${$m(deuda)}</div></div></div>
    <div class="row"><input id="cq" type="search" class="grow" placeholder="Buscar cliente…" value="${esc(S.cliQ)}"><button class="btn" data-act="nuevo-cli">${ic('plus')} Cliente</button></div>
    <div class="list" id="clist"></div></div>`;
  $('#cq').oninput = e => { S.cliQ = e.target.value; pintarClientes(); }; pintarClientes();
}
function pintarClientes() {
  const t = norm(S.cliQ);
  const l = S.clientes.filter(c => !t || norm(c.nombre).includes(t) || String(c.documento).includes(S.cliQ.trim())).sort((a, b) => num(b.deuda) - num(a.deuda)).slice(0, 200);
  $('#clist').innerHTML = l.map(c => `<button class="item" data-act="edit-cli" data-id="${esc(c.id)}"><div class="thumb">${esc((c.nombre || '?')[0].toUpperCase())}</div><div class="grow"><b>${esc(c.nombre)}</b><div class="muted sm">${esc(c.documento || 'Sin documento')} ${c.telefono ? '· ' + esc(c.telefono) : ''}</div></div>${num(c.deuda) > 0 ? `<span class="pill bad">Debe ${$m(c.deuda)}</span>` : ''}</button>`).join('') || '<div class="empty">Aún no hay clientes.</div>';
}
function formCliente(c, alGuardar) {
  const nuevo = !c; c = c || {};
  const m = modal(`<div class="row between"><h2 style="margin:0">${nuevo ? 'Nuevo cliente' : 'Cliente'}</h2><button class="icon-btn plain" data-close aria-label="Cerrar">${ic('x')}</button></div>
    <div class="stack" style="margin-top:12px"><label class="f"><span>Nombre o razón social *</span><input id="cn" type="text" value="${esc(c.nombre || '')}"></label>
    <div class="grid2"><label class="f"><span>DNI / RUC</span><input id="cd" type="text" inputmode="numeric" value="${esc(c.documento || '')}"></label><label class="f"><span>Celular</span><input id="ct" type="tel" value="${esc(c.telefono || '')}"></label></div>
    <label class="f"><span>Dirección</span><input id="cdir" type="text" value="${esc(c.direccion || '')}"></label>
    ${!nuevo && num(c.deuda) > 0 ? `<div class="card row between"><div><div class="muted sm">Deuda pendiente</div><b class="num" style="font-size:20px;color:var(--bad)">${$m(c.deuda)}</b></div><button class="btn aji" id="cab">Registrar abono</button></div>` : ''}
    <button class="btn block" id="cs">Guardar</button></div>`, { fijo: true });
  m.q('#cs').onclick = async () => {
    const cli = { id: c.id, nombre: m.q('#cn').value.trim(), documento: m.q('#cd').value.trim(), telefono: m.q('#ct').value.trim(), direccion: m.q('#cdir').value.trim() };
    if (!cli.nombre) return toast('Escribe el nombre', 'err');
    try { const r = await api('cliente_guardar', { cliente: cli }); const i = S.clientes.findIndex(x => x.id === r.id); if (i >= 0) S.clientes[i] = r; else S.clientes.push(r);
      guardarCache(); m.close(); toast('Cliente guardado', 'ok'); if (alGuardar) alGuardar(r); else renderVista(); } catch (e) { toast(e.message, 'err'); }
  };
  const ab = m.q('#cab');
  if (ab) ab.onclick = () => {
    const m2 = modal(`<h2>Abono de ${esc(c.nombre)}</h2><div class="stack"><label class="f"><span>Monto</span><input id="am" type="number" step="any" inputmode="decimal" value="${num(c.deuda)}"></label>
      <label class="f"><span>Método</span><select id="amet">${['efectivo', 'yape', 'plin', 'transferencia', 'tarjeta'].map(k => `<option value="${k}">${METODOS[k]}</option>`).join('')}</select></label>
      <button class="btn aji block" id="aok">Registrar abono</button></div>`);
    m2.q('#aok').onclick = async () => {
      const monto = r2(m2.q('#am').value); if (!(monto > 0)) return toast('Monto inválido', 'err');
      try { const r = await operacion('abono', { id: uid(), fecha: new Date().toISOString(), cliente_id: c.id, monto, metodo: m2.q('#amet').value });
        const cl = S.clientes.find(x => x.id === c.id); cl.deuda = r.cliente ? r.cliente.deuda : Math.max(0, r2(num(cl.deuda) - monto));
        guardarCache(); m2.close(); m.close(); toast(r.offline ? 'Abono guardado, se enviará al reconectar' : 'Abono registrado', 'ok'); renderVista(); } catch (e) { toast(e.message, 'err'); }
    };
  };
}

/* ---------- REPORTES Y CIERRE ---------- */
function rangoFechas() {
  const ini = new Date(); ini.setHours(0, 0, 0, 0); let fin = new Date(ini); fin.setHours(23, 59, 59, 999);
  switch (S.repPreset) {
    case 'ayer': ini.setDate(ini.getDate() - 1); fin = new Date(ini); fin.setHours(23, 59, 59, 999); break;
    case '7d': ini.setDate(ini.getDate() - 6); break;
    case 'mes': ini.setDate(1); break;
    case 'custom': if (S.repD1 && S.repD2) return { desde: new Date(S.repD1 + 'T00:00:00').toISOString(), hasta: new Date(S.repD2 + 'T23:59:59.999').toISOString() };
  }
  return { desde: ini.toISOString(), hasta: fin.toISOString() };
}
async function vistaReportes() {
  const admin = S.user.rol === 'admin';
  if (!admin) S.repPreset = 'hoy';
  $('#view').innerHTML = `<div class="stack">
    <div class="card" id="cajabox"><div class="muted">Cargando caja…</div></div>
    ${admin ? `<div class="chips">${[['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['mes', 'Este mes'], ['custom', 'Fechas']].map(([k, v]) => `<button class="chip ${S.repPreset === k ? 'on' : ''}" data-act="preset" data-p="${k}">${v}</button>`).join('')}</div>
    ${S.repPreset === 'custom' ? `<div class="grid2"><input type="date" id="d1" value="${S.repD1}"><input type="date" id="d2" value="${S.repD2}"></div>` : ''}` : ''}
    <div id="repbody"><div class="empty">Cargando reporte…</div></div></div>`;
  if (S.repPreset === 'custom') $$('#d1,#d2').forEach(i => i.onchange = () => { S.repD1 = $('#d1').value; S.repD2 = $('#d2').value; if (S.repD1 && S.repD2) vistaReportes(); });
  const [rp, cj] = await Promise.allSettled([api('ventas_rango', rangoFechas()), api('caja_estado')]);
  if (S.view !== 'reportes' || !$('#repbody')) return;
  if (cj.status === 'fulfilled') { S.caja = cj.value; pintarCaja(); } else $('#cajabox').innerHTML = `<div class="muted">No se pudo leer la caja: ${esc(cj.reason.message)}</div>`;
  if (rp.status === 'fulfilled') { S.rep = rp.value; pintarReporte(); } else $('#repbody').innerHTML = `<div class="empty">Los reportes necesitan conexión.<br>${esc(rp.reason.message)}</div>`;
}
function pintarCaja() {
  const c = S.caja; const b = $('#cajabox'); if (!b) return;
  if (!c.caja) { b.innerHTML = `<div class="row between"><div><h3 style="margin:0">Caja cerrada</h3><div class="muted sm">Abre la caja para llevar el control del efectivo.</div></div><button class="btn aji" data-act="abrir-caja">Abrir caja</button></div>`; return; }
  const r = c.resumen;
  b.innerHTML = `<div class="row between wrap"><div><h3 style="margin:0">Caja abierta <span class="pill ok">desde ${hora(c.caja.apertura)}</span></h3>
    <div class="muted sm">${r.n_ventas} venta(s) · ${$m(r.ventas_total)} vendidos · inicial ${$m(c.caja.monto_inicial)}</div></div>
    <div class="right"><div class="muted sm">Efectivo esperado</div><b class="num" style="font-size:22px">${$m(r.esperado_efectivo)}</b></div></div>
    <div class="row wrap" style="margin-top:10px"><button class="btn line sm" data-act="gasto">Registrar gasto</button><button class="btn sm grow" data-act="cerrar-caja">Cerrar caja</button></div>`;
}
function barras(items) {
  if (!items.length) return '';
  const W = 600, H = 150, mx = Math.max(...items.map(i => i.v), 1), bw = W / items.length, paso = Math.ceil(items.length / 12);
  return `<svg viewBox="0 0 ${W} ${H + 24}" width="100%" role="img" aria-label="Ventas por periodo">${items.map((it, i) => {
    const h = Math.max(it.v / mx * H, it.v > 0 ? 3 : 0);
    return `<rect x="${i * bw + bw * 0.15}" y="${H - h}" width="${bw * 0.7}" height="${h}" rx="3" fill="var(--ink-2)"><title>${esc(it.l)}: ${fmt(it.v)}</title></rect>${i % paso === 0 ? `<text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(it.l)}</text>` : ''}`;
  }).join('')}</svg>`;
}
function pintarReporte() {
  const admin = S.user.rol === 'admin', rep = S.rep;
  const ok = rep.ventas.filter(v => v.estado !== 'anulada'), ids = new Set(ok.map(v => v.id));
  const det = rep.detalle.filter(d => ids.has(d.venta_id));
  const total = sum(ok, v => v.total), igv = sum(ok, v => v.igv), costo = sum(det, d => d.cantidad * d.costo), gastos = sum(rep.gastos, g => g.monto);
  const utilidad = total - igv - costo;
  const met = {}; ok.forEach(v => { try { JSON.parse(v.pagos || '[]').forEach(p => { met[p.metodo] = num(met[p.metodo]) + num(p.monto); }); } catch (e) {} });
  const top = {}; det.forEach(d => { const t = top[d.producto_id] || (top[d.producto_id] = { n: d.nombre, c: 0, m: 0 }); t.c += num(d.cantidad); t.m += num(d.subtotal); });
  const topL = Object.values(top).sort((a, b) => b.m - a.m).slice(0, 6);
  const dias = {}; const porHora = S.repPreset === 'hoy' || S.repPreset === 'ayer';
  ok.forEach(v => { const d = new Date(v.fecha); const k = porHora ? d.getHours() : d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }); dias[k] = num(dias[k]) + num(v.total); });
  const serie = porHora ? Array.from({ length: 24 }, (_, h) => ({ l: h + 'h', v: num(dias[h]) })).filter((_, h) => h >= 6 && h <= 23) : Object.entries(dias).map(([l, v]) => ({ l, v }));
  const mx = Math.max(...Object.values(met), 1);
  $('#repbody').innerHTML = `<div class="stack"><div class="kpis"><div class="kpi"><div class="l">Ventas</div><div class="v num">${$m(total)}</div></div>
    <div class="kpi"><div class="l">N.º de ventas</div><div class="v num">${ok.length}</div></div>
    <div class="kpi"><div class="l">Ticket promedio</div><div class="v num">${$m(ok.length ? total / ok.length : 0)}</div></div>
    ${admin ? `<div class="kpi"><div class="l">Utilidad bruta</div><div class="v num" style="color:var(--ok)">${$m(utilidad)}</div></div>` : `<div class="kpi"><div class="l">Gastos</div><div class="v num">${$m(gastos)}</div></div>`}</div>
    ${admin ? `<div class="kpis"><div class="kpi"><div class="l">Gastos</div><div class="v num">${$m(gastos)}</div></div><div class="kpi"><div class="l">Utilidad neta</div><div class="v num" style="color:${utilidad - gastos >= 0 ? 'var(--ok)' : 'var(--bad)'}">${$m(utilidad - gastos)}</div></div></div>` : ''}
    <div class="card"><h3>${porHora ? 'Ventas por hora' : 'Ventas por día'}</h3>${barras(serie) || '<div class="muted">Sin ventas en este periodo.</div>'}</div>
    <div class="two"><div class="card"><h3>Por método de pago</h3>${Object.entries(met).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div style="margin-bottom:10px"><div class="row between sm"><span>${esc(METODOS[k] || k)}</span><b class="num">${$m(v)}</b></div><div class="bar"><i style="width:${v / mx * 100}%"></i></div></div>`).join('') || '<div class="muted">—</div>'}</div>
    <div class="card"><h3>Más vendidos</h3><table class="t">${topL.map(t => `<tr><td>${esc(t.n)}</td><td class="right num">${qty(t.c)}</td><td class="right num">${$m(t.m)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div></div>
    <div class="card"><div class="row between"><h3>Ventas del periodo</h3>${admin ? '<button class="btn line sm" data-act="csv-ventas">Exportar CSV</button>' : ''}</div>
    <div class="list">${rep.ventas.slice().reverse().slice(0, 60).map(v => `<button class="item" data-act="ver-venta" data-id="${esc(v.id)}"><div class="grow"><b class="num">${esc(v.serie_numero)}</b> ${v.estado === 'anulada' ? '<span class="pill bad">Anulada</span>' : ''}<div class="muted sm">${fechaHora(v.fecha)} · ${esc(v.cliente_nombre || 'Público general')} · ${esc(v.usuario)}</div></div><b class="num">${$m(v.total)}</b></button>`).join('') || '<div class="empty">Sin ventas.</div>'}</div></div>
    <div class="card"><div class="row between"><h3>Gastos</h3><button class="btn line sm" data-act="gasto">${ic('plus', 16)} Gasto</button></div>
    <table class="t">${rep.gastos.slice().reverse().map(g => `<tr><td>${fechaHora(g.fecha)}</td><td>${esc(g.categoria)}<div class="muted sm">${esc(g.descripcion)}</div></td><td class="right num">${$m(g.monto)}</td></tr>`).join('') || '<tr><td class="muted">Sin gastos.</td></tr>'}</table></div></div>`;
}
function verVenta(id) {
  const v = S.rep.ventas.find(x => x.id === id); if (!v) return;
  const items = S.rep.detalle.filter(d => d.venta_id === id); let pagos = []; try { pagos = JSON.parse(v.pagos || '[]'); } catch (e) {}
  const m = modal(`<div class="row between"><h2 style="margin:0">${esc(COMPROBANTES[v.comprobante])} ${esc(v.serie_numero)}</h2><button class="icon-btn plain" data-close aria-label="Cerrar">${ic('x')}</button></div>
    <p class="muted sm">${new Date(v.fecha).toLocaleString('es-PE')} · ${esc(v.cliente_nombre || 'Público general')} · ${esc(v.usuario)}</p>
    <table class="t">${items.map(i => `<tr><td>${esc(i.nombre)}</td><td class="num">${qty(i.cantidad)} × ${fmt(i.precio)}</td><td class="right num">${fmt(i.subtotal)}</td></tr>`).join('')}</table>
    <div class="row between" style="margin:12px 0"><span>Pagos: ${pagos.map(p => esc(METODOS[p.metodo]) + ' ' + fmt(p.monto)).join(' + ')}</span><b class="num" style="font-size:20px">${$m(v.total)}</b></div>
    ${v.notas ? `<p class="muted sm">${esc(v.notas)}</p>` : ''}
    <div class="row"><button class="btn line grow" id="vp">${ic('print')} Reimprimir</button>${S.user.rol === 'admin' && v.estado !== 'anulada' ? '<button class="btn bad grow" id="va">Anular venta</button>' : ''}</div>`);
  m.q('#vp').onclick = () => imprimirTicket({ serie: v.serie_numero, usuario: v.usuario, calc: { subtotal: num(v.subtotal), descuento: num(v.descuento), total: num(v.total), igv: num(v.igv), vuelto: num(v.vuelto) },
    v: { comprobante: v.comprobante, fecha: v.fecha, cliente: v.cliente_nombre ? { nombre: v.cliente_nombre, documento: v.cliente_doc } : null, items: items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precio })), pagos: pagos.map(p => ({ metodo: p.metodo, monto: p.recibido || p.monto })) } });
  const va = m.q('#va');
  if (va) va.onclick = async () => {
    const mot = await preguntar({ titulo: 'Anular venta', etiqueta: 'Motivo', valor: '', ok: 'Anular' }); if (mot === null) return;
    try { const r = await api('venta_anular', { id, motivo: mot }); aplicarStocks(r.stocks); if (r.cliente) { const c = S.clientes.find(c => c.id === r.cliente.id); if (c) c.deuda = r.cliente.deuda; } guardarCache(); m.close(); toast('Venta anulada y stock restituido', 'ok'); vistaReportes(); } catch (e) { toast(e.message, 'err'); }
  };
}
function formGasto() {
  const cats = ['Mercadería', 'Alquiler', 'Servicios (luz/agua/internet)', 'Sueldos', 'Transporte', 'Impuestos', 'Mantenimiento', 'Otros'];
  const m = modal(`<h2>Registrar gasto</h2><div class="stack"><label class="f"><span>Categoría</span><select id="gc">${cats.map(c => `<option>${c}</option>`).join('')}</select></label>
    <label class="f"><span>Descripción</span><input id="gd" type="text"></label><div class="grid2"><label class="f"><span>Monto</span><input id="gm" type="number" step="any" inputmode="decimal"></label>
    <label class="f"><span>Pagado con</span><select id="gmet">${['efectivo', 'yape', 'plin', 'transferencia', 'tarjeta'].map(k => `<option value="${k}">${METODOS[k]}</option>`).join('')}</select></label></div>
    <button class="btn block" id="gok">Guardar gasto</button></div>`);
  m.q('#gok').onclick = async () => {
    const monto = r2(m.q('#gm').value); if (!(monto > 0)) return toast('Indica el monto', 'err');
    try { const r = await operacion('gasto', { id: uid(), fecha: new Date().toISOString(), categoria: m.q('#gc').value, descripcion: m.q('#gd').value.trim(), monto, metodo: m.q('#gmet').value });
      m.close(); toast(r.offline ? 'Gasto guardado, se enviará al reconectar' : 'Gasto registrado', 'ok'); if (S.view === 'reportes') vistaReportes(); } catch (e) { toast(e.message, 'err'); }
  };
}
async function abrirCaja() {
  const v = await preguntar({ titulo: 'Abrir caja', etiqueta: 'Efectivo inicial en caja', valor: '0', tipo: 'number', ok: 'Abrir' }); if (v === null) return;
  try { await api('caja_abrir', { monto_inicial: num(v) }); toast('Caja abierta', 'ok'); vistaReportes(); } catch (e) { toast(e.message, 'err'); }
}
function cerrarCaja() {
  const c = S.caja; if (!c || !c.caja) return; const r = c.resumen;
  const m = modal(`<h2>Cierre de caja</h2><table class="t"><tr><td>Efectivo inicial</td><td class="right num">${$m(c.caja.monto_inicial)}</td></tr>
    ${Object.entries(r.metodos).map(([k, v]) => `<tr><td>Ventas ${esc(METODOS[k] || k)}</td><td class="right num">${$m(v)}</td></tr>`).join('')}
    <tr><td>Abonos en efectivo</td><td class="right num">${$m(r.abonos_efectivo)}</td></tr><tr><td>Gastos en efectivo</td><td class="right num">−${$m(r.gastos_efectivo)}</td></tr>
    <tr><td><b>Efectivo esperado</b></td><td class="right num"><b>${$m(r.esperado_efectivo)}</b></td></tr></table>
    <div class="stack" style="margin-top:12px"><label class="f"><span>Efectivo contado</span><input id="cc" type="number" step="any" inputmode="decimal"></label>
    <div id="cdif" class="pill" style="justify-content:center;padding:8px">Ingresa lo contado</div><label class="f"><span>Observaciones</span><input id="cn" type="text"></label>
    <button class="btn aji lg block" id="cok">Cerrar caja</button></div>`, { fijo: true });
  m.q('#cc').oninput = e => { const d = r2(num(e.target.value) - r.esperado_efectivo), el = m.q('#cdif'); el.className = 'pill ' + (Math.abs(d) < 0.01 ? 'ok' : 'bad'); el.textContent = Math.abs(d) < 0.01 ? 'Cuadra perfecto' : (d > 0 ? 'Sobra ' : 'Falta ') + $m(Math.abs(d)); };
  m.q('#cok').onclick = async () => {
    if (m.q('#cc').value === '') return toast('Ingresa el efectivo contado', 'err');
    try { const x = await api('caja_cerrar', { contado: num(m.q('#cc').value), notas: m.q('#cn').value.trim() }); m.close(); toast('Caja cerrada. Diferencia: ' + $m(x.caja.diferencia), 'ok'); vistaReportes(); } catch (e) { toast(e.message, 'err'); }
  };
}
function csvVentas() {
  const esc2 = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const filas = [['Fecha', 'Comprobante', 'Cliente', 'Subtotal', 'Descuento', 'IGV', 'Total', 'Estado', 'Usuario'], ...S.rep.ventas.map(v => [new Date(v.fecha).toLocaleString('es-PE'), v.serie_numero, v.cliente_nombre, v.subtotal, v.descuento, v.igv, v.total, v.estado, v.usuario])];
  descargar('ventas_qillqapos.csv', filas.map(f => f.map(esc2).join(',')).join('\n'));
}

/* ---------- CONFIGURACIÓN E INTEGRACIONES ---------- */
function vistaAjustes() {
  const c = S.cfg, campo = (k, et, tipo = 'text') => `<label class="f"><span>${et}</span><input type="${tipo}" name="${k}" value="${esc(c[k] || '')}"></label>`;
  $('#view').innerHTML = `<div class="stack" style="max-width:760px">
    ${S.errores.length ? `<div class="banner" style="background:var(--bad-bg)">${S.errores.length} operación(es) offline fueron rechazadas por el servidor (${esc(S.errores[0].error)}). <button class="btn-ghost" data-act="limpiar-err">Descartar</button></div>` : ''}
    <div class="card"><h3>Datos del negocio</h3><div class="stack"><div class="grid2">${campo('negocio', 'Nombre comercial')}${campo('ruc', 'RUC')}</div>${campo('direccion', 'Dirección')}
      <div class="grid2">${campo('telefono', 'Teléfono')}${campo('moneda', 'Símbolo de moneda')}</div>${campo('mensaje_ticket', 'Mensaje al pie del ticket')}</div></div>
    <div class="card"><h3>Comprobantes e impuestos</h3><div class="stack"><div class="grid3">${campo('serie_ticket', 'Serie ticket')}${campo('serie_boleta', 'Serie boleta')}${campo('serie_factura', 'Serie factura')}</div>
      <div class="grid2"><label class="f"><span>Precios incluyen IGV</span><select name="igv_activo"><option value="no" ${c.igv_activo !== 'si' ? 'selected' : ''}>No mostrar IGV</option><option value="si" ${c.igv_activo === 'si' ? 'selected' : ''}>Sí, desglosar IGV</option></select></label>${campo('igv_pct', 'IGV %', 'number')}</div>
      <label class="f"><span>Vender con stock en cero</span><select name="stock_negativo"><option value="si" ${c.stock_negativo !== 'no' ? 'selected' : ''}>Permitir</option><option value="no" ${c.stock_negativo === 'no' ? 'selected' : ''}>Bloquear</option></select></label>
      <p class="muted sm" style="margin:0">Los tickets, boletas y facturas de QillqaPOS son documentos de control interno, no comprobantes electrónicos SUNAT.</p></div></div>
    <div class="card"><h3>Yape y Plin</h3><div class="stack">${['yape', 'plin'].map(k => `<div class="row"><div class="grow">${campo(k + '_numero', 'Número de ' + k.toUpperCase(), 'tel')}</div>
      ${c[k + '_qr'] ? `<img class="qr" style="width:64px;height:64px" src="${esc(c[k + '_qr'])}" alt="QR ${k}">` : ''}<label class="btn line sm">QR<input type="file" accept="image/*" data-qr="${k}_qr" hidden></label></div>`).join('')}</div></div>
    <button class="btn lg block" data-act="guardar-cfg">Guardar configuración</button>
    <div class="card"><h3>Usuarios y PIN</h3><div class="list">${S.usuarios.map(u => `<div class="item"><div class="grow"><b>${esc(u.usuario)}</b> <span class="pill">${esc(u.rol)}</span></div><button class="btn line sm" data-act="edit-user" data-u="${esc(u.usuario)}" data-r="${esc(u.rol)}">Editar PIN</button><button class="btn-ghost" data-act="del-user" data-u="${esc(u.usuario)}" aria-label="Eliminar">${ic('x', 18)}</button></div>`).join('')}</div>
      <button class="btn line block" style="margin-top:10px" data-act="edit-user" data-u="" data-r="cajero">${ic('plus')} Agregar usuario</button>
      <p class="muted sm">Los PIN sirven para separar funciones en el equipo; no reemplazan el cuidado del token de conexión.</p></div>
    <div class="card"><h3>Conexión con Google Sheets</h3><div class="stack">
      <div class="row between"><span>Estado</span><span id="estado2">${navigator.onLine ? '<span class="pill ok">Conectado</span>' : '<span class="pill warn">Sin internet</span>'}</span></div>
      <div class="row between"><span>Operaciones por enviar</span><b class="num">${S.pendientes}</b></div>
      <div class="row wrap"><button class="btn line grow" data-act="sync">${ic('refresh')} Sincronizar ahora</button><button class="btn line grow" data-act="copiar-enlace">Copiar enlace para otro equipo</button></div>
      ${deferredInstall ? `<button class="btn aji block" data-act="instalar">Instalar QillqaPOS en este dispositivo</button>` : ''}
      <button class="btn-ghost" data-act="desconectar">Desconectar este dispositivo</button></div></div></div>`;
  $$('[data-qr]').forEach(i => i.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = await reducirImagen(f, 500); const r = await api('subir_imagen', { clave: i.dataset.qr, b64: b64(d) }, 60000); S.cfg[i.dataset.qr] = r.url; guardarCache(); toast('QR guardado', 'ok'); vistaAjustes(); } catch (err) { toast(err.message, 'err'); }
  });
}
function formUsuario(u, rol) {
  const m = modal(`<h2>${u ? 'Editar ' + esc(u) : 'Nuevo usuario'}</h2><div class="stack"><label class="f"><span>Usuario</span><input id="uu" type="text" value="${esc(u)}" ${u ? 'readonly' : ''}></label>
    <label class="f"><span>PIN (4 a 8 dígitos)</span><input id="up" type="password" inputmode="numeric" maxlength="8"></label>
    <label class="f"><span>Rol</span><select id="ur"><option value="cajero" ${rol !== 'admin' ? 'selected' : ''}>Cajero (vende, clientes, cierre)</option><option value="admin" ${rol === 'admin' ? 'selected' : ''}>Administrador (todo)</option></select></label>
    <button class="btn block" id="uok">Guardar</button></div>`);
  m.q('#uok').onclick = async () => { try { await api('usuario_guardar', { usuario: m.q('#uu').value.trim(), pin: m.q('#up').value, rol: m.q('#ur').value }); m.close(); await sincronizar(true); toast('Usuario guardado', 'ok'); vistaAjustes(); } catch (e) { toast(e.message, 'err'); } };
}
const codigoConexion = () => btoa(JSON.stringify({ u: CONN.url, t: CONN.token }));

/* ---------- Eventos globales ---------- */
const ACCIONES = {
  ir: b => { S.view = b.dataset.v; render(); },
  sync: async () => { await sincronizar(false); if (S.user && !S.usuarios.some(u => u.usuario === S.user.usuario)) return ACCIONES.salir(); renderVista(); },
  salir: () => { S.user = null; localStorage.removeItem('qp_user'); limpiarVenta(); render(); },
  scan: () => abrirEscaner(c => { const p = S.productos.find(p => String(p.codigo) === String(c)); if (p) { agregarAlCarrito(p); toast('+ ' + p.nombre, 'ok'); } else toast('Código no registrado: ' + c, 'err'); }, { continuo: true, titulo: 'Escanear productos' }),
  'scan-inv': () => abrirEscaner(c => { S.invQ = c; const i = $('#iq'); if (i) i.value = c; pintarInv(); }),
  cat: b => { S.cat = b.dataset.c; pintarChips(); pintarGrid(); },
  add: b => agregarAlCarrito(S.productos.find(p => p.id === b.dataset.id)),
  vaciar: async () => { if (await confirmar('¿Vaciar la venta actual?', 'Vaciar', true)) limpiarVenta(); },
  menos: b => { const it = S.cart[+b.dataset.i]; it.cantidad = r3(num(it.cantidad) - 1); if (it.cantidad <= 0) S.cart.splice(+b.dataset.i, 1); pintarCarrito(); },
  mas: b => { const it = S.cart[+b.dataset.i]; it.cantidad = r3(num(it.cantidad) + 1); pintarCarrito(); },
  quitar: b => { S.cart.splice(+b.dataset.i, 1); pintarCarrito(); },
  precio: async b => { const it = S.cart[+b.dataset.i]; const v = await preguntar({ titulo: 'Precio de ' + it.nombre, etiqueta: 'Precio unitario', valor: it.precio, tipo: 'number' }); if (v !== null && num(v) >= 0 && v !== '') { it.precio = num(v); pintarCarrito(); } },
  descuento: async () => { const v = await preguntar({ titulo: 'Descuento', etiqueta: 'Monto a descontar (' + (S.cfg.moneda || 'S/') + ')', valor: S.descuento || '', tipo: 'number' }); if (v !== null) { S.descuento = Math.max(0, num(v)); pintarCarrito(); } },
  'elegir-cliente': () => elegirCliente(),
  cobrar: () => abrirCobro(),
  'abrir-cart': () => $('#cart').classList.add('open'),
  'cerrar-cart': () => $('#cart').classList.remove('open'),
  ingreso: () => formIngreso(),
  'nuevo-prod': () => formProducto(null),
  'edit-prod': b => formProducto(S.productos.find(p => p.id === b.dataset.id)),
  invf: b => { S.invF = b.dataset.f; vistaInventario(); },
  'csv-inv': () => { const e = s => '"' + String(s ?? '').replace(/"/g, '""') + '"'; descargar('inventario_qillqapos.csv', [['Código', 'Nombre', 'Categoría', 'Unidad', 'Costo', 'Precio', 'Stock', 'Stock mínimo'], ...S.productos.map(p => [p.codigo, p.nombre, p.categoria, p.unidad, p.costo, p.precio, p.stock, p.stock_min])].map(f => f.map(e).join(',')).join('\n')); },
  'nuevo-cli': () => formCliente(null),
  'edit-cli': b => formCliente(S.clientes.find(c => c.id === b.dataset.id)),
  preset: b => { S.repPreset = b.dataset.p; vistaReportes(); },
  'abrir-caja': abrirCaja, 'cerrar-caja': cerrarCaja, gasto: formGasto,
  'ver-venta': b => verVenta(b.dataset.id), 'csv-ventas': csvVentas,
  'guardar-cfg': async () => {
    const cfg = {}; $$('#view [name]').forEach(i => { cfg[i.name] = i.value.trim(); });
    try { await api('config_guardar', { config: cfg }); Object.assign(S.cfg, cfg); guardarCache(); toast('Configuración guardada', 'ok'); } catch (e) { toast(e.message, 'err'); }
  },
  'edit-user': b => formUsuario(b.dataset.u, b.dataset.r),
  'del-user': async b => { if (!(await confirmar('¿Eliminar al usuario ' + b.dataset.u + '?', 'Eliminar', true))) return; try { await api('usuario_eliminar', { usuario: b.dataset.u }); await sincronizar(true); vistaAjustes(); } catch (e) { toast(e.message, 'err'); } },
  'copiar-enlace': async () => { const url = location.origin + location.pathname + '#c=' + encodeURIComponent(codigoConexion()); try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Quien lo abra queda conectado.', 'ok'); } catch (e) { preguntar({ titulo: 'Copia el enlace', etiqueta: '', valor: url }); } },
  instalar: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; vistaAjustes(); },
  desconectar: async () => { if (await confirmar('¿Desconectar este dispositivo de la hoja?', 'Desconectar', true)) { localStorage.removeItem('qp_conn'); localStorage.removeItem('qp_user'); CONN = null; S.user = null; render(); } },
  'limpiar-err': async () => { S.errores = []; await idb.set('errores', []); vistaAjustes(); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && ACCIONES[b.dataset.act]) ACCIONES[b.dataset.act](b, e); });
document.addEventListener('change', e => {
  const i = e.target.dataset.cant;
  if (i !== undefined) { const v = num(e.target.value); if (v <= 0) S.cart.splice(+i, 1); else S.cart[+i].cantidad = v; pintarCarrito(); }
});
window.addEventListener('online', () => { S.online = true; pintarEstado(); sincronizar(true).then(() => { if (S.view === 'venta') { pintarChips && $('#grid') && (pintarChips(), pintarGrid()); } }); });
window.addEventListener('offline', () => pintarEstado());
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

/* ---------- Arranque ---------- */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const h = location.hash.match(/^#c=(.+)$/);
  if (h) { try { const j = JSON.parse(atob(decodeURIComponent(h[1]))); if (j.u && j.t) { CONN = { url: j.u, token: j.t }; localStorage.setItem('qp_conn', JSON.stringify(CONN)); } } catch (e) {} history.replaceState(null, '', location.pathname + location.search); }
  const cache = await idb.get('cache').catch(() => null);
  if (cache) Object.assign(S, cache);
  S.pendientes = ((await idb.get('queue').catch(() => null)) || []).length; S.errores = (await idb.get('errores').catch(() => null)) || [];
  if (CONN && !cache) { $('#app').innerHTML = '<div class="center"><div class="muted">Cargando datos…</div></div>'; await sincronizar(true); }
  render();
  if (CONN && cache) sincronizar(true).then(() => {
    if (S.user && S.usuarios.length && !S.usuarios.some(u => u.usuario === S.user.usuario)) return ACCIONES.salir();
    if (S.user) { const u = S.usuarios.find(u => u.usuario === S.user.usuario); if (u && u.rol !== S.user.rol) { S.user.rol = u.rol; localStorage.setItem('qp_user', JSON.stringify(S.user)); render(); return; } }
    if (S.view === 'venta' && $('#grid')) { pintarChips(); pintarGrid(); }
  });
  setInterval(() => { if (navigator.onLine && CONN && S.pendientes) vaciarCola(); }, 30000);
}
boot();
