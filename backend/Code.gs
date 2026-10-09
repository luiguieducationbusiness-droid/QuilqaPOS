/**
 * QillqaPOS — API para Google Sheets (Apps Script enlazado a la hoja).
 * Pasos: pegar en Extensiones > Apps Script, ejecutar configurarInicial(), implementar como Aplicación web.
 */
const VERSION = '1.0.0';

const ESQUEMA = {
  Productos:   ['id','codigo','nombre','categoria','unidad','costo','precio','stock','stock_min','proveedor','foto','activo','actualizado'],
  Ventas:      ['id','fecha','comprobante','serie_numero','cliente_id','cliente_nombre','cliente_doc','subtotal','descuento','igv','total','pagos','vuelto','estado','usuario','notas'],
  Detalle:     ['venta_id','producto_id','codigo','nombre','cantidad','precio','costo','subtotal'],
  Movimientos: ['fecha','tipo','producto_id','nombre','cantidad','costo','stock_resultante','referencia','usuario','notas'],
  Clientes:    ['id','documento','nombre','telefono','direccion','deuda','creado'],
  Abonos:      ['id','fecha','cliente_id','monto','metodo','usuario'],
  Gastos:      ['id','fecha','categoria','descripcion','monto','metodo','usuario'],
  Caja:        ['id','apertura','cierre','usuario','monto_inicial','esperado_efectivo','contado','diferencia','ventas_total','detalle_metodos','estado','notas'],
  Usuarios:    ['usuario','pin','rol'],
  Config:      ['clave','valor']
};
const COLS_FECHA = ['fecha','apertura','cierre','creado','actualizado'];
const COLS_TEXTO = ['id','codigo','documento','telefono','serie_numero','venta_id','producto_id','cliente_id','referencia','usuario','pin','clave','valor'];

const CONFIG_DEFECTO = {
  negocio: 'Mi Bodega', ruc: '', direccion: '', telefono: '', moneda: 'S/',
  igv_activo: 'no', igv_pct: '18',
  serie_ticket: 'T001', serie_boleta: 'B001', serie_factura: 'F001',
  corr_ticket: '0', corr_boleta: '0', corr_factura: '0',
  yape_numero: '', yape_qr: '', plin_numero: '', plin_qr: '',
  stock_negativo: 'si', mensaje_ticket: '¡Gracias por su compra!', token: ''
};

/* ---------- Menú y configuración inicial ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('QillqaPOS')
    .addItem('1. Configuración inicial', 'configurarInicial')
    .addItem('2. Mostrar código de conexión', 'mostrarCodigoConexion')
    .addToUi();
}

function configurarInicial() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(ESQUEMA).forEach(function (nombre) {
    const cols = ESQUEMA[nombre];
    let sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    if (sh.getRange(1, 1).getValue() === '') {
      sh.getRange(1, 1, 1, cols.length).setValues([cols])
        .setFontWeight('bold').setBackground('#1B2A49').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
    cols.forEach(function (c, i) {
      const rango = sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1);
      if (COLS_TEXTO.indexOf(c) >= 0) rango.setNumberFormat('@');
      if (COLS_FECHA.indexOf(c) >= 0) rango.setNumberFormat('dd/mm/yyyy hh:mm:ss');
    });
  });
  ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) ss.deleteSheet(s);
  });
  const cfg = leerConfig_();
  if (!cfg.token) {
    cfg.token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  }
  guardarConfig_(cfg);
  if (leer_('Usuarios').length === 0) {
    agregar_('Usuarios', { usuario: 'admin', pin: '1234', rol: 'admin' });
  }
  // Fuerza la autorización de Drive (fotos de productos y QR).
  DriveApp.getRootFolder();
  Logger.log('Listo. Ahora implementa como Aplicación web y usa el menú QillqaPOS > Mostrar código de conexión.');
  try { SpreadsheetApp.getUi().alert('QillqaPOS', 'Configuración lista. Usuario inicial: admin / PIN 1234.\nSiguiente paso: Implementar > Nueva implementación > Aplicación web.', SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

function mostrarCodigoConexion() {
  const cfg = leerConfig_();
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  const codigo = Utilities.base64Encode(JSON.stringify({ u: url, t: cfg.token }));
  const html = '<div style="font-family:sans-serif;font-size:13px">' +
    '<p><b>URL de la aplicación web</b>' + (url ? '' : ' (aún no implementada)') + '</p>' +
    '<textarea style="width:100%;height:50px" readonly>' + url + '</textarea>' +
    '<p><b>Token</b></p><textarea style="width:100%;height:36px" readonly>' + cfg.token + '</textarea>' +
    '<p><b>Código de conexión</b> (pégalo en la app y listo)</p>' +
    '<textarea style="width:100%;height:90px" readonly>' + codigo + '</textarea></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(360), 'Conexión de QillqaPOS');
}

/* ---------- Punto de entrada HTTP ---------- */
function doGet() { return salida_({ ok: true, app: 'QillqaPOS', version: VERSION }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return salida_({ ok: false, error: 'Solicitud inválida' }); }
  try {
    const cfg = leerConfig_();
    if (!cfg.token || req.token !== cfg.token) return salida_({ ok: false, error: 'Token inválido', code: 'auth' });
    const fn = ACCIONES[req.action];
    if (!fn) return salida_({ ok: false, error: 'Acción desconocida: ' + req.action });
    let data;
    if (LECTURA.indexOf(req.action) >= 0) {
      data = fn(req.data || {}, req.user || '', cfg);
    } else {
      const lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try { data = fn(req.data || {}, req.user || '', leerConfig_()); } finally { lock.releaseLock(); }
    }
    return salida_({ ok: true, data: data });
  } catch (err) {
    return salida_({ ok: false, error: String(err && err.message || err) });
  }
}

function salida_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- Utilidades de hoja ---------- */
function hoja_(n) {
  const sh = SpreadsheetApp.getActive().getSheetByName(n);
  if (!sh) throw new Error('Falta la hoja "' + n + '". Ejecuta QillqaPOS > Configuración inicial.');
  return sh;
}
function leer_(n) {
  const sh = hoja_(n), cols = ESQUEMA[n], last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map(function (r, i) {
    const o = { _fila: i + 2 };
    cols.forEach(function (c, j) { let v = r[j]; if (v instanceof Date) v = v.toISOString(); o[c] = v; });
    return o;
  });
}
function fila_(n, o) {
  return ESQUEMA[n].map(function (c) {
    const v = o[c];
    if (v === undefined || v === null) return '';
    if (COLS_FECHA.indexOf(c) >= 0 && v !== '') return new Date(v);
    return v;
  });
}
function agregar_(n, o) {
  const sh = hoja_(n);
  sh.getRange(sh.getLastRow() + 1, 1, 1, ESQUEMA[n].length).setValues([fila_(n, o)]);
}
function actualizar_(n, fila, o) { hoja_(n).getRange(fila, 1, 1, ESQUEMA[n].length).setValues([fila_(n, o)]); }
function celda_(n, fila, col, valor) { hoja_(n).getRange(fila, ESQUEMA[n].indexOf(col) + 1).setValue(valor); }
function limpiar_(o) { const c = Object.assign({}, o); delete c._fila; return c; }
function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function ahora_() { return new Date().toISOString(); }
function nuevoId_(p) { return p + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }

function leerConfig_() {
  const cfg = Object.assign({}, CONFIG_DEFECTO);
  const sh = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sh) return cfg;
  leer_('Config').forEach(function (r) { if (r.clave) cfg[r.clave] = String(r.valor); });
  return cfg;
}
function guardarConfig_(obj) {
  const sh = hoja_('Config');
  const filas = leer_('Config');
  Object.keys(obj).forEach(function (k) {
    const f = filas.filter(function (r) { return r.clave === k; })[0];
    const val = String(obj[k]);
    if (f) sh.getRange(f._fila, 2).setValue(val);
    else { sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[k, val]]); }
  });
}
function siguienteNumero_(tipo) {
  const cfg = leerConfig_();
  const n = (parseInt(cfg['corr_' + tipo], 10) || 0) + 1;
  const o = {}; o['corr_' + tipo] = n;
  guardarConfig_(o);
  return cfg['serie_' + tipo] + '-' + ('00000000' + n).slice(-8);
}
function hashPin_(usuario, pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, usuario + ':' + String(pin) + ':qillqa', Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function mov_(tipo, p, cantidad, stockRes, ref, usuario, notas, costo) {
  agregar_('Movimientos', { fecha: ahora_(), tipo: tipo, producto_id: p.id, nombre: p.nombre, cantidad: cantidad, costo: costo === undefined ? p.costo : costo, stock_resultante: stockRes, referencia: ref || '', usuario: usuario || '', notas: notas || '' });
}
function guardarImagen_(b64, nombre) {
  try {
    const it = DriveApp.getFoldersByName('QillqaPOS_imagenes');
    const carpeta = it.hasNext() ? it.next() : DriveApp.createFolder('QillqaPOS_imagenes');
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', nombre + '.jpg');
    const f = carpeta.createFile(blob);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w400';
  } catch (e) { throw new Error('No se pudo guardar la imagen en Drive: ' + e.message); }
}
function parsePagos_(s) { try { return JSON.parse(s || '[]'); } catch (e) { return []; } }

/* ---------- Acciones ---------- */
const LECTURA = ['sync', 'ventas_rango', 'caja_estado'];
const ACCIONES = {
  sync: accSync_, producto_guardar: accProductoGuardar_, producto_eliminar: accProductoEliminar_,
  ingreso: accIngreso_, ajuste: accAjuste_, venta: accVenta_, venta_anular: accAnular_,
  cliente_guardar: accClienteGuardar_, abono: accAbono_, gasto: accGasto_,
  ventas_rango: accVentasRango_, caja_estado: accCajaEstado_, caja_abrir: accCajaAbrir_, caja_cerrar: accCajaCerrar_,
  config_guardar: accConfigGuardar_, subir_imagen: accSubirImagen_,
  usuario_guardar: accUsuarioGuardar_, usuario_eliminar: accUsuarioEliminar_
};

function accSync_(d, u, cfg) {
  const pub = Object.assign({}, cfg); delete pub.token;
  return {
    config: pub,
    productos: leer_('Productos').filter(function (p) { return p.activo !== 'no'; }).map(limpiar_),
    clientes: leer_('Clientes').map(limpiar_),
    usuarios: leer_('Usuarios').map(function (x) { return { usuario: x.usuario, rol: x.rol, hash: hashPin_(x.usuario, x.pin) }; }),
    hora: ahora_()
  };
}

function accProductoGuardar_(d, u) {
  const p = d.producto || {};
  if (!p.nombre) throw new Error('Falta el nombre del producto');
  const prods = leer_('Productos');
  const codigo = String(p.codigo || '').trim();
  if (codigo) {
    const dup = prods.filter(function (x) { return String(x.codigo) === codigo && x.id !== p.id && x.activo !== 'no'; })[0];
    if (dup) throw new Error('Ese código ya existe en: ' + dup.nombre);
  }
  const foto = d.foto_b64 ? guardarImagen_(d.foto_b64, 'prod_' + Date.now()) : null;
  const base = {
    codigo: codigo, nombre: String(p.nombre).trim(), categoria: p.categoria || '', unidad: p.unidad || 'unidad',
    costo: Number(p.costo) || 0, precio: Number(p.precio) || 0, stock_min: Number(p.stock_min) || 0,
    proveedor: p.proveedor || '', actualizado: ahora_()
  };
  if (p.id) {
    const ex = prods.filter(function (x) { return x.id === p.id; })[0];
    if (!ex) throw new Error('Producto no encontrado');
    const nuevo = Object.assign({}, ex, base, { foto: foto || ex.foto });
    actualizar_('Productos', ex._fila, nuevo);
    return limpiar_(nuevo);
  }
  const nuevo = Object.assign({ id: nuevoId_('P'), stock: Number(p.stock) || 0, foto: foto || '', activo: 'si' }, base);
  agregar_('Productos', nuevo);
  if (nuevo.stock !== 0) mov_('stock_inicial', nuevo, nuevo.stock, nuevo.stock, '', u, 'Alta de producto');
  return limpiar_(nuevo);
}

function accProductoEliminar_(d) {
  const p = leer_('Productos').filter(function (x) { return x.id === d.id; })[0];
  if (!p) throw new Error('Producto no encontrado');
  celda_('Productos', p._fila, 'activo', 'no');
  return { id: d.id };
}

function accIngreso_(d, u) {
  if (!d.items || !d.items.length) throw new Error('No hay productos en el ingreso');
  const prods = leer_('Productos');
  const ref = d.referencia || ('ING-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm'));
  const out = [];
  d.items.forEach(function (it) {
    const p = prods.filter(function (x) { return x.id === it.producto_id; })[0];
    if (!p) throw new Error('Producto no encontrado en el ingreso');
    const cant = Number(it.cantidad);
    if (!(cant > 0)) throw new Error('Cantidad inválida para ' + p.nombre);
    const stock = (Number(p.stock) || 0) + cant;
    const costo = (it.costo !== undefined && it.costo !== '' && it.costo !== null) ? Number(it.costo) : (Number(p.costo) || 0);
    const precio = (it.precio !== undefined && it.precio !== '' && it.precio !== null && Number(it.precio) > 0) ? Number(it.precio) : Number(p.precio) || 0;
    celda_('Productos', p._fila, 'stock', stock);
    celda_('Productos', p._fila, 'costo', costo);
    celda_('Productos', p._fila, 'precio', precio);
    celda_('Productos', p._fila, 'actualizado', new Date());
    if (d.proveedor) celda_('Productos', p._fila, 'proveedor', d.proveedor);
    p.stock = stock;
    mov_('ingreso', p, cant, stock, ref, u, d.proveedor ? 'Proveedor: ' + d.proveedor : '', costo);
    out.push({ id: p.id, stock: stock, costo: costo, precio: precio });
  });
  return { referencia: ref, productos: out };
}

function accAjuste_(d, u) {
  const p = leer_('Productos').filter(function (x) { return x.id === d.producto_id; })[0];
  if (!p) throw new Error('Producto no encontrado');
  const nuevo = Number(d.stock_nuevo);
  if (isNaN(nuevo)) throw new Error('Stock inválido');
  celda_('Productos', p._fila, 'stock', nuevo);
  mov_('ajuste', p, nuevo - (Number(p.stock) || 0), nuevo, '', u, d.motivo || 'Ajuste manual');
  return { id: p.id, stock: nuevo };
}

function accVenta_(d, u, cfg) {
  const v = d.venta;
  if (!v || !v.id) throw new Error('Venta inválida');
  const ya = leer_('Ventas').filter(function (x) { return x.id === v.id; })[0];
  if (ya) return { venta: limpiar_(ya), duplicada: true, stocks: [] };
  if (!v.items || !v.items.length) throw new Error('La venta no tiene productos');

  const prods = leer_('Productos');
  let subtotal = 0;
  const detalle = [];
  v.items.forEach(function (it) {
    const p = prods.filter(function (x) { return x.id === it.producto_id; })[0];
    if (!p) throw new Error('Producto no encontrado: ' + (it.nombre || it.producto_id));
    const cant = Number(it.cantidad), precio = Number(it.precio);
    if (!(cant > 0) || !(precio >= 0)) throw new Error('Cantidad o precio inválido en ' + p.nombre);
    if (cfg.stock_negativo === 'no' && (Number(p.stock) || 0) < cant) throw new Error('Stock insuficiente: ' + p.nombre);
    subtotal += cant * precio;
    detalle.push({ p: p, cant: cant, precio: precio });
  });
  subtotal = r2(subtotal);
  const descuento = r2(Math.min(Math.max(Number(v.descuento) || 0, 0), subtotal));
  const total = r2(subtotal - descuento);
  const pct = Number(cfg.igv_pct) || 18;
  const igv = cfg.igv_activo === 'si' ? r2(total - total / (1 + pct / 100)) : 0;

  const pagos = (v.pagos || []).map(function (p) { return { metodo: p.metodo, monto: r2(p.monto), ref: p.ref || '' }; }).filter(function (p) { return p.monto > 0; });
  const pagado = r2(pagos.reduce(function (a, p) { return a + p.monto; }, 0));
  if (pagado + 0.001 < total) throw new Error('El pago (' + pagado + ') es menor al total (' + total + ')');
  const vuelto = r2(pagado - total);
  const efectivoRec = r2(pagos.filter(function (p) { return p.metodo === 'efectivo'; }).reduce(function (a, p) { return a + p.monto; }, 0));
  if (vuelto > efectivoRec + 0.001) throw new Error('El vuelto no puede exceder el efectivo recibido');
  if (vuelto > 0) {
    const pe = pagos.filter(function (p) { return p.metodo === 'efectivo'; })[0];
    pe.recibido = pe.monto; pe.monto = r2(pe.monto - vuelto);
  }
  const credito = r2(pagos.filter(function (p) { return p.metodo === 'credito'; }).reduce(function (a, p) { return a + p.monto; }, 0));

  let cliente = null;
  if (v.cliente && v.cliente.id) cliente = leer_('Clientes').filter(function (c) { return c.id === v.cliente.id; })[0] || null;
  if (credito > 0 && !cliente) throw new Error('Para vender a crédito debes elegir un cliente');
  const tipo = ['ticket', 'boleta', 'factura'].indexOf(v.comprobante) >= 0 ? v.comprobante : 'ticket';
  if (tipo === 'factura' && (!cliente || String(cliente.documento).length !== 11)) throw new Error('La factura requiere un cliente con RUC de 11 dígitos');

  const serie = siguienteNumero_(tipo);
  const venta = {
    id: v.id, fecha: v.fecha || ahora_(), comprobante: tipo, serie_numero: serie,
    cliente_id: cliente ? cliente.id : '', cliente_nombre: cliente ? cliente.nombre : '', cliente_doc: cliente ? cliente.documento : '',
    subtotal: subtotal, descuento: descuento, igv: igv, total: total, pagos: JSON.stringify(pagos), vuelto: vuelto,
    estado: 'emitida', usuario: u, notas: v.notas || ''
  };
  agregar_('Ventas', venta);

  const stocks = [];
  detalle.forEach(function (x) {
    agregar_('Detalle', { venta_id: v.id, producto_id: x.p.id, codigo: x.p.codigo, nombre: x.p.nombre, cantidad: x.cant, precio: x.precio, costo: Number(x.p.costo) || 0, subtotal: r2(x.cant * x.precio) });
    const nuevo = (Number(x.p.stock) || 0) - x.cant;
    celda_('Productos', x.p._fila, 'stock', nuevo);
    x.p.stock = nuevo;
    mov_('venta', x.p, -x.cant, nuevo, serie, u, '');
    stocks.push({ id: x.p.id, stock: nuevo });
  });
  let cli = null;
  if (credito > 0) {
    const deuda = r2((Number(cliente.deuda) || 0) + credito);
    celda_('Clientes', cliente._fila, 'deuda', deuda);
    cli = { id: cliente.id, deuda: deuda };
  }
  return { venta: venta, stocks: stocks, cliente: cli };
}

function accAnular_(d, u) {
  const v = leer_('Ventas').filter(function (x) { return x.id === d.id; })[0];
  if (!v) throw new Error('Venta no encontrada');
  if (v.estado === 'anulada') throw new Error('La venta ya está anulada');
  const prods = leer_('Productos');
  const stocks = [];
  leer_('Detalle').filter(function (x) { return x.venta_id === v.id; }).forEach(function (it) {
    const p = prods.filter(function (x) { return x.id === it.producto_id; })[0];
    if (!p) return;
    const nuevo = (Number(p.stock) || 0) + Number(it.cantidad);
    celda_('Productos', p._fila, 'stock', nuevo);
    p.stock = nuevo;
    mov_('anulacion', p, Number(it.cantidad), nuevo, v.serie_numero, u, d.motivo || '');
    stocks.push({ id: p.id, stock: nuevo });
  });
  let cli = null;
  const credito = parsePagos_(v.pagos).filter(function (p) { return p.metodo === 'credito'; }).reduce(function (a, p) { return a + Number(p.monto); }, 0);
  if (credito > 0 && v.cliente_id) {
    const c = leer_('Clientes').filter(function (x) { return x.id === v.cliente_id; })[0];
    if (c) { const deuda = Math.max(0, r2((Number(c.deuda) || 0) - credito)); celda_('Clientes', c._fila, 'deuda', deuda); cli = { id: c.id, deuda: deuda }; }
  }
  celda_('Ventas', v._fila, 'estado', 'anulada');
  celda_('Ventas', v._fila, 'notas', ((v.notas ? v.notas + ' | ' : '') + 'Anulada: ' + (d.motivo || 'sin motivo')));
  return { id: v.id, stocks: stocks, cliente: cli };
}

function accClienteGuardar_(d) {
  const c = d.cliente || {};
  if (!c.nombre) throw new Error('Falta el nombre del cliente');
  const todos = leer_('Clientes');
  const doc = String(c.documento || '').trim();
  if (doc) {
    const dup = todos.filter(function (x) { return String(x.documento) === doc && x.id !== c.id; })[0];
    if (dup) throw new Error('Ya existe un cliente con ese documento: ' + dup.nombre);
  }
  if (c.id) {
    const ex = todos.filter(function (x) { return x.id === c.id; })[0];
    if (!ex) throw new Error('Cliente no encontrado');
    const nuevo = Object.assign({}, ex, { documento: doc, nombre: c.nombre.trim(), telefono: String(c.telefono || ''), direccion: c.direccion || '' });
    actualizar_('Clientes', ex._fila, nuevo);
    return limpiar_(nuevo);
  }
  const nuevo = { id: nuevoId_('C'), documento: doc, nombre: c.nombre.trim(), telefono: String(c.telefono || ''), direccion: c.direccion || '', deuda: 0, creado: ahora_() };
  agregar_('Clientes', nuevo);
  return nuevo;
}

function accAbono_(d, u) {
  if (leer_('Abonos').filter(function (a) { return a.id === d.id; })[0]) return { duplicado: true };
  const c = leer_('Clientes').filter(function (x) { return x.id === d.cliente_id; })[0];
  if (!c) throw new Error('Cliente no encontrado');
  const monto = r2(d.monto);
  if (!(monto > 0)) throw new Error('Monto inválido');
  const deuda = Math.max(0, r2((Number(c.deuda) || 0) - monto));
  celda_('Clientes', c._fila, 'deuda', deuda);
  agregar_('Abonos', { id: d.id || nuevoId_('A'), fecha: d.fecha || ahora_(), cliente_id: c.id, monto: monto, metodo: d.metodo || 'efectivo', usuario: u });
  return { cliente: { id: c.id, deuda: deuda } };
}

function accGasto_(d, u) {
  if (d.id && leer_('Gastos').filter(function (g) { return g.id === d.id; })[0]) return { duplicado: true };
  const monto = r2(d.monto);
  if (!(monto > 0)) throw new Error('Monto inválido');
  agregar_('Gastos', { id: d.id || nuevoId_('G'), fecha: d.fecha || ahora_(), categoria: d.categoria || 'Otros', descripcion: d.descripcion || '', monto: monto, metodo: d.metodo || 'efectivo', usuario: u });
  return { ok: true };
}

function accVentasRango_(d) {
  const ventas = leer_('Ventas').filter(function (v) { return v.fecha >= d.desde && v.fecha <= d.hasta; }).map(limpiar_);
  const ids = {}; ventas.forEach(function (v) { ids[v.id] = 1; });
  return {
    ventas: ventas,
    detalle: leer_('Detalle').filter(function (x) { return ids[x.venta_id]; }).map(limpiar_),
    gastos: leer_('Gastos').filter(function (g) { return g.fecha >= d.desde && g.fecha <= d.hasta; }).map(limpiar_),
    abonos: leer_('Abonos').filter(function (a) { return a.fecha >= d.desde && a.fecha <= d.hasta; }).map(limpiar_)
  };
}

function resumenDesde_(desde) {
  const ventas = leer_('Ventas').filter(function (v) { return v.estado !== 'anulada' && v.fecha >= desde; });
  const metodos = {};
  let total = 0;
  ventas.forEach(function (v) {
    total += Number(v.total) || 0;
    parsePagos_(v.pagos).forEach(function (p) { metodos[p.metodo] = r2((metodos[p.metodo] || 0) + Number(p.monto)); });
  });
  const abonos = leer_('Abonos').filter(function (a) { return a.fecha >= desde; });
  const abonosEf = abonos.filter(function (a) { return a.metodo === 'efectivo'; }).reduce(function (s, a) { return s + Number(a.monto); }, 0);
  const abonosTot = abonos.reduce(function (s, a) { return s + Number(a.monto); }, 0);
  const gastosEf = leer_('Gastos').filter(function (g) { return g.fecha >= desde && g.metodo === 'efectivo'; }).reduce(function (s, g) { return s + Number(g.monto); }, 0);
  return { metodos: metodos, ventas_total: r2(total), n_ventas: ventas.length, abonos_efectivo: r2(abonosEf), abonos_total: r2(abonosTot), gastos_efectivo: r2(gastosEf) };
}
function cajaAbierta_() {
  const abiertas = leer_('Caja').filter(function (c) { return c.estado === 'abierta'; });
  return abiertas.length ? abiertas[abiertas.length - 1] : null;
}
function accCajaEstado_() {
  const c = cajaAbierta_();
  if (!c) return { caja: null };
  const r = resumenDesde_(c.apertura);
  r.esperado_efectivo = r2((Number(c.monto_inicial) || 0) + (r.metodos.efectivo || 0) + r.abonos_efectivo - r.gastos_efectivo);
  return { caja: limpiar_(c), resumen: r };
}
function accCajaAbrir_(d, u) {
  if (cajaAbierta_()) throw new Error('Ya hay una caja abierta');
  const c = { id: nuevoId_('K'), apertura: ahora_(), cierre: '', usuario: u, monto_inicial: r2(d.monto_inicial || 0), estado: 'abierta', notas: '' };
  agregar_('Caja', c);
  return { caja: c };
}
function accCajaCerrar_(d, u) {
  const c = cajaAbierta_();
  if (!c) throw new Error('No hay caja abierta');
  const r = resumenDesde_(c.apertura);
  const esperado = r2((Number(c.monto_inicial) || 0) + (r.metodos.efectivo || 0) + r.abonos_efectivo - r.gastos_efectivo);
  const contado = r2(d.contado || 0);
  const cerrada = Object.assign({}, c, { cierre: ahora_(), esperado_efectivo: esperado, contado: contado, diferencia: r2(contado - esperado), ventas_total: r.ventas_total, detalle_metodos: JSON.stringify(r.metodos), estado: 'cerrada', notas: d.notas || '' });
  actualizar_('Caja', c._fila, cerrada);
  return { caja: limpiar_(cerrada), resumen: r };
}

function accConfigGuardar_(d) {
  const permitido = Object.keys(CONFIG_DEFECTO).filter(function (k) { return k !== 'token' && k.indexOf('corr_') !== 0; });
  const o = {};
  Object.keys(d.config || {}).forEach(function (k) { if (permitido.indexOf(k) >= 0) o[k] = d.config[k]; });
  guardarConfig_(o);
  return { ok: true };
}
function accSubirImagen_(d) {
  if (['yape_qr', 'plin_qr'].indexOf(d.clave) < 0) throw new Error('Clave de imagen no permitida');
  const url = guardarImagen_(d.b64, d.clave + '_' + Date.now());
  guardarConfig_((function () { const o = {}; o[d.clave] = url; return o; })());
  return { url: url };
}
function accUsuarioGuardar_(d) {
  const nombre = String(d.usuario || '').trim(), pin = String(d.pin || '').trim();
  if (!nombre) throw new Error('Falta el nombre de usuario');
  if (!/^\d{4,8}$/.test(pin)) throw new Error('El PIN debe tener de 4 a 8 dígitos');
  const rol = d.rol === 'admin' ? 'admin' : 'cajero';
  const ex = leer_('Usuarios').filter(function (x) { return x.usuario === nombre; })[0];
  if (ex) actualizar_('Usuarios', ex._fila, { usuario: nombre, pin: pin, rol: rol });
  else agregar_('Usuarios', { usuario: nombre, pin: pin, rol: rol });
  return { ok: true };
}
function accUsuarioEliminar_(d) {
  const us = leer_('Usuarios');
  const ex = us.filter(function (x) { return x.usuario === d.usuario; })[0];
  if (!ex) throw new Error('Usuario no encontrado');
  if (ex.rol === 'admin' && us.filter(function (x) { return x.rol === 'admin'; }).length < 2) throw new Error('Debe quedar al menos un administrador');
  hoja_('Usuarios').deleteRow(ex._fila);
  return { ok: true };
}
