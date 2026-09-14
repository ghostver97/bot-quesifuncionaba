process.on('uncaughtException', (err) => {
    console.error('❌ ERROR NO CAPTURADO:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ PROMESA RECHAZADA:', reason);
});

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestWaWebVersion
} = require('@whiskeysockets/baileys');

const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');

// ======================================================
// CONFIGURACIÓN
// ======================================================

const DATA_DIR =
    process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';

// NUEVA CARPETA PARA IGNORAR LA SESIÓN BANEADA
const AUTH_DIR =
    path.join(DATA_DIR, 'sesion_tienda_v3');

const DB_FILE =
    path.join(DATA_DIR, 'db.json');

// Crear carpeta de datos
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

console.log('');
console.log('========================================');
console.log('🤖 BOT TIENDA SAMANTHA');
console.log('========================================');
console.log('📁 DATA_DIR:', DATA_DIR);
console.log('🔐 AUTH_DIR:', AUTH_DIR);
console.log('🗄️ DB_FILE:', DB_FILE);
console.log('========================================');
console.log('');

// ======================================================
// EXPRESS
// ======================================================

let qrImage = '';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    if (qrImage) {
        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="10">
    <title>Bot Tienda Samantha</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: Arial, Helvetica, sans-serif; background: linear-gradient(135deg, #111827, #1f2937); color: #111827; }
        .card { width: 90%; max-width: 450px; background: white; padding: 30px; border-radius: 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
        h1 { margin-top: 0; font-size: 25px; }
        img { width: 280px; height: 280px; max-width: 100%; margin: 15px 0; border-radius: 10px; }
        .success { color: #16a34a; font-weight: bold; }
        .info { color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>📱 Vincular Bot WhatsApp</h1>
        <p>Escanea este código QR desde WhatsApp.</p>
        <img src="${qrImage}" alt="Código QR de WhatsApp">
        <p class="success">🟢 QR generado correctamente</p>
        <p class="info">El código se actualiza automáticamente.</p>
        <p class="info">Bot Tienda Samantha Online 24/7 🚀</p>
    </div>
</body>
</html>
        `);
    } else {
        res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="5">
    <title>Bot Tienda Samantha</title>
</head>
<body style="margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; font-family:Arial, sans-serif; background:#f4f4f9; text-align:center;">
    <div>
        <h1>🤖 Bot Tienda Samantha Online 24/7 🚀</h1>
        <p><b>Estado:</b> conectando con WhatsApp...</p>
        <p>El QR aparecerá automáticamente.</p>
        <p>🔄 Recargando...</p>
    </div>
</body>
</html>
        `);
    }
});

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        bot: 'Tienda Samantha',
        qr: !!qrImage,
        time: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor Express activo en puerto ${PORT}`);
});

// ======================================================
// BASE DE DATOS
// ======================================================

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            saldos: {},
            stock: {},
            precios: {},
            pago: "",
            ventas: []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        console.log('🗄️ db.json creado correctamente.');
        return initialData;
    }

    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        
        // Actualizar bases de datos viejas para incluir pagos y ventas sin borrar nada
        if (!data.pago) data.pago = "";
        if (!data.ventas) data.ventas = [];
        
        return data;
    } catch (error) {
        console.error('❌ ERROR LEYENDO db.json:', error);
        return { saldos: {}, stock: {}, precios: {}, pago: "", ventas: [] };
    }
}

function saveDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ ERROR GUARDANDO db.json:', error);
    }
}

// ======================================================
// CONTROL DE RECONEXIÓN
// ======================================================

let reconnectTimer = null;
let botStarting = false;

function scheduleReconnect(delay = 5000) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBot();
    }, delay);
}

// ======================================================
// INICIAR BOT
// ======================================================

async function startBot() {
    if (botStarting) {
        console.log('⚠️ El bot ya se está iniciando.');
        return;
    }

    botStarting = true;

    try {
        console.log('');
        console.log('========================================');
        console.log('🚀 INICIANDO BAILEYS');
        console.log('========================================');

        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
            console.log('📁 Carpeta de autenticación creada.');
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        console.log('🔐 Estado de autenticación cargado.');

        const { version, isLatest } = await fetchLatestWaWebVersion();
        console.log('📱 Versión REAL de WhatsApp Web:', version.join('.'));
        console.log('⭐ ¿Es la última versión?:', isLatest);

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'debug' }),
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: undefined,
            keepAliveIntervalMs: 30000,
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('');
                console.log('========================================');
                console.log('📱 QR RECIBIDO DE WHATSAPP');
                console.log('========================================');
                try {
                    qrImage = await QRCode.toDataURL(qr);
                    console.log('✅ QR convertido a imagen correctamente.');
                    console.log('🌐 Abre la URL pública de Railway.');
                } catch (error) {
                    console.error('❌ ERROR GENERANDO QR:', error);
                }
            }

            if (connection === 'close') {
                qrImage = '';
                const error = lastDisconnect?.error;
                const statusCode = error?.output?.statusCode;

                console.log('');
                console.log('========================================');
                console.error('❌ CONEXIÓN WHATSAPP CERRADA');
                console.log('========================================');
                console.error('Código:', statusCode);
                console.error('Mensaje:', error?.message);

                // NUEVO: Detecta 401 (Sesión cerrada) y 403 (Baneo) para borrar los datos
                if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
                    console.log('🚪 WhatsApp cerró la sesión o el número fue baneado.');
                    console.log('🗑️ Eliminando credenciales...');
                    try {
                        if (fs.existsSync(AUTH_DIR)) {
                            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                        }
                    } catch (error) {
                        console.error('❌ ERROR ELIMINANDO AUTH:', error);
                    }
                    qrImage = '';
                    console.log('🔄 Se generará un QR nuevo en el próximo inicio.');
                } else {
                    console.log('🔄 WhatsApp cerró la conexión por otro motivo.');
                    console.log('⏳ Reconectando en 5 segundos...');
                }

                botStarting = false;
                scheduleReconnect();
                return;
            }

            if (connection === 'open') {
                console.log('');
                console.log('========================================');
                console.log('✅ WHATSAPP CONECTADO CORRECTAMENTE');
                console.log('========================================');
                qrImage = '';
                botStarting = false;
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            try {
                if (type !== 'notify') return;

                const m = messages[0];
                if (!m || !m.message || m.key.fromMe) return;

                const from = m.key.remoteJid;
                if (!from) return;

                const isGroup = from.endsWith('@g.us');
                const sender = isGroup ? m.key.participant : from;

                const body = m.message.conversation || m.message.extendedTextMessage?.text || '';
                if (!body.startsWith('.')) return;

                const args = body.slice(1).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                const db = loadDB();

                async function isAdmin() {
                    if (!isGroup) return false;
                    try {
                        const metadata = await sock.groupMetadata(from);
                        const participant = metadata.participants.find(p => p.id === sender);
                        return (participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
                    } catch (error) {
                        console.error('❌ ERROR COMPROBANDO ADMIN:', error);
                        return false;
                    }
                }

                // ==================================================
                // .AYUDA / .COMANDOS
                // ==================================================
                if (command === 'ayuda' || command === 'comandos') {
                    let text = `🤖 *LISTA DE COMANDOS - TIENDA SAMANTHA*\n\n`;
                    text += `👤 *Comandos Públicos:*\n`;
                    text += `• *.menu* o *.tienda* - Catálogo de productos.\n`;
                    text += `• *.stock* - Ver la cantidad disponible.\n`;
                    text += `• *.saldo* - Revisar cuánto dinero tienes.\n`;
                    text += `• *.comprar <producto>* - Adquirir una cuenta/acta.\n`;
                    text += `• *.pago* - Ver los datos para hacer depósitos/transferencias.\n\n`;
                    text += `👑 *Solo Administradores:*\n`;
                    text += `• *.addsaldo <@usuario> <cantidad>* - Recargar saldo.\n`;
                    text += `• *.setprecio <producto> <precio>* - Modificar precios.\n`;
                    text += `• *.addstock <producto> <credenciales>* - Subir inventario.\n`;
                    text += `• *.setpago <clabe o info>* - Configurar la cuenta bancaria.\n`;
                    text += `• *.ventas* - Ver todas las compras realizadas.\n`;
                    text += `• *.abrir* - Desbloquear el grupo para que todos hablen.\n`;
                    text += `• *.cerrar* - Bloquear el grupo (solo admins escriben).`;

                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                // ==================================================
                // .MENU / .TIENDA
                // ==================================================
                else if (command === 'menu' || command === 'tienda') {
                    let text = `🛒 *MENÚ DE TIENDA SAMANTHA*\n\n`;
                    text += `👤 *Tu Saldo:* $${db.saldos[sender] || 0} MXN\n\n`;
                    text += `📦 *Productos disponibles:*\n`;

                    const productos = Object.keys(db.precios);
                    if (productos.length === 0) {
                        text += `_No hay productos registrados aún._\n`;
                    } else {
                        productos.forEach(producto => {
                            const precio = db.precios[producto];
                            const cantStock = (db.stock[producto] || []).length;
                            text += `• *${producto.toUpperCase()}* - $${precio} MXN (Stock: ${cantStock})\n`;
                        });
                    }

                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                // ==================================================
                // .SALDO
                // ==================================================
                else if (command === 'saldo') {
                    const saldo = db.saldos[sender] || 0;
                    await sock.sendMessage(from, { text: `💰 Tu saldo actual es: *$${saldo} MXN*` }, { quoted: m });
                }

                // ==================================================
                // .STOCK
                // ==================================================
                else if (command === 'stock') {
                    let text = `📦 *INVENTARIO DISPONIBLE:*\n\n`;
                    for (const producto in db.precios) {
                        const cant = (db.stock[producto] || []).length;
                        text += `• *${producto.toUpperCase()}*: ${cant} disponibles\n`;
                    }
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                // ==================================================
                // .PAGO
                // ==================================================
                else if (command === 'pago') {
                    const infoPago = db.pago || "No hay datos bancarios registrados aún.";
                    const text = `${infoPago}\n\n*PAGOS DE TRANSFERENCIAS*`;
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                // ==================================================
                // .SETPAGO
                // ==================================================
                else if (command === 'setpago') {
                    if (!(await isAdmin())) return;
                    
                    const clabe = args.join(' ');
                    if (!clabe) return sock.sendMessage(from, { text: '❌ Escribe la información bancaria después del comando. Ejemplo: *.setpago 123456789 Banamex a nombre de Samantha*' }, { quoted: m });
                    
                    db.pago = clabe;
                    saveDB(db);
                    
                    await sock.sendMessage(from, { text: `✅ Datos de transferencia actualizados.` }, { quoted: m });
                }

                // ==================================================
                // .VENTAS
                // ==================================================
                else if (command === 'ventas') {
                    if (!(await isAdmin())) return;
                    
                    if (!db.ventas || db.ventas.length === 0) {
                        return sock.sendMessage(from, { text: '📈 Aún no se han registrado ventas en la base de datos.' }, { quoted: m });
                    }

                    let text = `📈 *ÚLTIMAS VENTAS REGISTRADAS*\n\n`;
                    
                    // Mostrar solo las últimas 30 para evitar mensajes gigantes
                    const ultimasVentas = db.ventas.slice(-30); 
                    
                    ultimasVentas.forEach((v, i) => {
                        const usuarioTag = v.comprador.split('@')[0];
                        // Ajustamos la fecha a zona horaria de México
                        const fechaVenta = new Date(v.fecha).toLocaleString('es-MX', {timeZone: 'America/Mexico_City'});
                        text += `${i + 1}. *${v.producto.toUpperCase()}* - $${v.precio} MXN\n👤 @${usuarioTag}\n📅 ${fechaVenta}\n\n`;
                    });

                    // Array de menciones para que los números salgan en azul (etiquetados)
                    const menciones = ultimasVentas.map(v => v.comprador);
                    
                    await sock.sendMessage(from, { text, mentions: menciones }, { quoted: m });
                }

                // ==================================================
                // .ABRIR / .CERRAR GRUPO
                // ==================================================
                else if (command === 'abrir' || command === 'cerrar') {
                    if (!isGroup) return sock.sendMessage(from, { text: '❌ Este comando solo se puede usar dentro de un grupo.' }, { quoted: m });
                    if (!(await isAdmin())) return; // Solo administradores lo ejecutan, el bot ignora si no es admin.

                    try {
                        const configuracion = command === 'abrir' ? 'not_announcement' : 'announcement';
                        await sock.groupSettingUpdate(from, configuracion);
                        
                        await sock.sendMessage(from, { 
                            text: `✅ Grupo ${command === 'abrir' ? 'abierto. Todos los miembros ya pueden enviar mensajes.' : 'cerrado. Solo los administradores pueden escribir.'}` 
                        }, { quoted: m });
                    } catch (error) {
                        await sock.sendMessage(from, { text: '❌ Error. Asegúrate de que el Bot sea Administrador del grupo para poder abrir/cerrar.' }, { quoted: m });
                    }
                }

                // ==================================================
                // .COMPRAR
                // ==================================================
                else if (command === 'comprar') {
                    const producto = args[0]?.toLowerCase();

                    if (!producto || !db.precios[producto]) {
                        return sock.sendMessage(from, { text: `❌ Producto no válido o no existe.` }, { quoted: m });
                    }

                    const precio = db.precios[producto];
                    const userSaldo = db.saldos[sender] || 0;

                    if (userSaldo < precio) {
                        return sock.sendMessage(from, { text: `❌ Saldo insuficiente.` }, { quoted: m });
                    }

                    if (!db.stock[producto] || db.stock[producto].length === 0) {
                        return sock.sendMessage(from, { text: `❌ Producto agotado.` }, { quoted: m });
                    }

                    db.saldos[sender] -= precio;
                    const cuentaEntregada = db.stock[producto].shift();
                    
                    // NUEVO: Registrar el historial de venta en la base de datos
                    if (!db.ventas) db.ventas = [];
                    db.ventas.push({
                        comprador: sender,
                        producto: producto,
                        precio: precio,
                        fecha: new Date().toISOString()
                    });

                    saveDB(db);

                    await sock.sendMessage(sender, {
                        text: `🎉 *¡COMPRA EXITOSA!*\n\n📦 *Producto:* ${producto.toUpperCase()}\n\n🔑 *Credenciales:*\n${cuentaEntregada}`
                    });

                    await sock.sendMessage(from, {
                        text: `✅ Compra realizada. Te enviamos las credenciales por mensaje privado.`
                    }, { quoted: m });
                }

                // ==================================================
                // .ADDSALDO
                // ==================================================
                else if (command === 'addsaldo') {
                    if (!(await isAdmin())) return;

                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    const monto = parseInt(args[1] || args[0]);

                    if (!mentioned || isNaN(monto)) return;

                    db.saldos[mentioned] = (db.saldos[mentioned] || 0) + monto;
                    saveDB(db);

                    await sock.sendMessage(from, { text: `✅ Saldo actualizado.`, mentions: [mentioned] }, { quoted: m });
                }

                // ==================================================
                // .ADDSTOCK
                // ==================================================
                else if (command === 'addstock') {
                    if (!(await isAdmin())) return;

                    const producto = args[0]?.toLowerCase();
                    const cuenta = args.slice(1).join(' ');

                    if (!producto || !cuenta) return;

                    if (!db.stock[producto]) {
                        db.stock[producto] = [];
                    }

                    db.stock[producto].push(cuenta);
                    saveDB(db);

                    await sock.sendMessage(from, { text: `✅ Stock actualizado.` }, { quoted: m });
                }

                // ==================================================
                // .SETPRECIO
                // ==================================================
                else if (command === 'setprecio') {
                    if (!(await isAdmin())) return;

                    const producto = args[0]?.toLowerCase();
                    const precio = parseInt(args[1]);

                    if (!producto || isNaN(precio)) return;

                    db.precios[producto] = precio;

                    if (!db.stock[producto]) {
                        db.stock[producto] = [];
                    }

                    saveDB(db);

                    await sock.sendMessage(from, { text: `✅ Precio actualizado.` }, { quoted: m });
                }

            } catch (error) {
                console.error('❌ ERROR PROCESANDO MENSAJE:', error);
            }
        });

        botStarting = false;

    } catch (error) {
        botStarting = false;

        console.error('');
        console.error('========================================');
        console.error('🔥 ERROR INICIANDO BAILEYS');
        console.error('========================================');
        console.error(error);
        console.error('Mensaje:', error?.message);
        console.error('Stack:', error?.stack);

        console.log('🔄 Reintentando en 10 segundos...');
        setTimeout(() => {
            startBot();
        }, 10000);
    }
}

// ======================================================
// INICIAR
// ======================================================
startBot();
