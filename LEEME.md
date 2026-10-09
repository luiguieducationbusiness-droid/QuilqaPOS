# QillqaPOS — Punto de venta PWA conectado a Google Sheets

Contenido:
- `backend/Code.gs` (+ `appsscript.json` opcional): API en Google Apps Script que guarda todo en tu hoja.
- `pwa/`: la aplicación (HTML/CSS/JS, sin instalar nada). Se sube tal cual a cualquier hosting estático.

## Puesta en marcha (≈10 minutos)

### 1. Backend (tu Google Sheet)
1. Crea una hoja de cálculo nueva en Google Sheets.
2. Menú **Extensiones → Apps Script**. Borra el código de ejemplo y pega todo `backend/Code.gs`. Guarda.
3. Arriba elige la función **`configurarInicial`** y pulsa **Ejecutar**. Acepta los permisos
   (si dice "app no verificada": *Configuración avanzada → Ir a proyecto*). Es tu propio script.
   Esto crea las pestañas (Productos, Ventas, Detalle, Movimientos, Clientes, Abonos, Gastos, Caja, Usuarios, Config),
   genera tu token y crea el usuario **admin / PIN 1234**.
4. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
   - Copia la URL que termina en `/exec`.
5. Recarga la hoja y usa el menú **QillqaPOS → Mostrar código de conexión**. Copia el *Código de conexión*.

### 2. Frontend (la app)
Sube la carpeta `pwa/` a un hosting HTTPS (necesario para cámara e instalación):
- **Netlify Drop** (app.netlify.com/drop): arrastra la carpeta `pwa` y listo.
- **Cloudflare Pages**, **GitHub Pages** o **Vercel** también sirven.

### 3. Primer uso
1. Abre la URL, pega el *Código de conexión* y pulsa **Conectar hoja**.
2. Entra con **admin / 1234** y **cambia el PIN** en Configuración → Usuarios.
3. En Configuración llena los datos del negocio, tu número y QR de Yape/Plin.
4. En el celular: menú del navegador → **Instalar app / Añadir a pantalla de inicio**.
5. Para otros equipos: Configuración → **Copiar enlace para otro equipo** (ya lleva la conexión).

## Qué incluye
- **Caja de venta**: búsqueda, categorías, escáner con cámara (o lector USB), descuentos, precio editable,
  cliente, ticket/boleta/factura (control interno), pagos mixtos (Efectivo con vuelto, Yape, Plin, Tarjeta,
  Transferencia, Crédito/fiado), QR de cobro, ticket imprimible (58/80 mm) y envío por WhatsApp.
- **Inventario y mercadería**: alta de productos con foto de cámara, ingreso de mercadería (proveedor, costo,
  precio), ajustes de stock, alertas de stock bajo, kardex en la hoja *Movimientos*, exportación CSV.
- **Reportes y cierre**: ventas, ticket promedio, utilidad bruta/neta, métodos de pago, más vendidos,
  gastos, apertura/cierre de caja con diferencia, anulación de ventas (repone stock), CSV.
- **Clientes**: fiados, abonos y deuda.
- **Configuración**: negocio, series, IGV, Yape/Plin, usuarios con PIN (admin/cajero), enlace de conexión.
- **Sin internet**: las ventas, gastos y abonos se guardan en el equipo y se envían solos al reconectar.

## Cosas que conviene saber
- Inventario, clientes, reportes y configuración requieren conexión (solo ventas/gastos/abonos funcionan offline).
- Si modificas `Code.gs`: *Implementar → Administrar implementaciones → Editar → Nueva versión*.
- Si actualizas archivos de `pwa/`, sube el número `VERSION` en `sw.js` para que los equipos se actualicen.
- Los comprobantes de la app **no son comprobantes electrónicos SUNAT**. Para emitir facturas/boletas
  electrónicas hay que integrar un OSE/PSE (p. ej. Nubefact); la venta ya guarda todos los datos necesarios.
- Seguridad: quien tenga el token puede leer/escribir en la hoja. Los PIN separan funciones del equipo, no
  sustituyen cuidar el token. No compartas el enlace de conexión públicamente.
- Google Apps Script tiene cuotas diarias; sobra para una bodega o tienda pequeña. Con muchos miles de
  ventas por mes conviene archivar periodos antiguos de *Ventas/Detalle*.
- El lector de códigos usa la cámara nativa (Chrome/Android); en iPhone carga una librería la primera vez (requiere internet).
