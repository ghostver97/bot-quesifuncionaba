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
    fetchLatestWaWebVersion,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');

// ======================================================
// CONFIGURACIÓN
// ======================================================

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';
const AUTH_DIR = path.join(DATA_DIR, 'sesion_tienda_v3');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log('');
console.log('========================================');
console.log('🤖 BOT TIENDA SAMANTHA LA HACKER');
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
    res.json({ ok: true, bot: 'Tienda Samantha', qr: !!qrImage, time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor Express activo en puerto ${PORT}`);
});

// ======================================================
// BASE DE DATOS
// ======================================================

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { saldos: {}, stock: {}, precios: {}, pago: "", ventas: [], grupos: {}, textos: {} };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        if (!data.pago) data.pago = "";
        if (!data.ventas) data.ventas = [];
        if (!data.grupos) data.grupos = {};
        if (!data.textos) data.textos = {}; // NUEVO: Para guardar textos de comandos personalizados
        return data;
    } catch (error) {
        console.error('❌ ERROR LEYENDO db.json:', error);
        return { saldos: {}, stock: {}, precios: {}, pago: "", ventas: [], grupos: {}, textos: {} };
    }
}

function saveDB(data) {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } 
    catch (error) { console.error('❌ ERROR GUARDANDO db.json:', error); }
}

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
// FUNCIÓN PARA CORTAR NÚMEROS
// ======================================================
function obtenerNumeroBase(jid) {
    if (!jid) return '';
    let num = jid.split('@')[0].split(':')[0];
    if (num.length >= 10) {
        return num.slice(-10);
    }
    return num;
}

// ======================================================
// INICIAR BOT
// ======================================================

async function startBot() {
    if (botStarting) return;
    botStarting = true;

    try {
        console.log('\n========================================');
        console.log('🚀 INICIANDO BAILEYS');
        console.log('========================================');

        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const { version, isLatest } = await fetchLatestWaWebVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }), 
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    qrImage = await QRCode.toDataURL(qr);
                    console.log('✅ QR convertido a imagen correctamente.');
                } catch (error) { console.error('❌ ERROR GENERANDO QR:', error); }
            }

            if (connection === 'close') {
                qrImage = '';
                const error = lastDisconnect?.error;
                const statusCode = error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 403) {
                    console.log('🚪 WhatsApp cerró la sesión o el número fue baneado.');
                    try { if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } 
                    catch (error) { console.error('❌ ERROR ELIMINANDO AUTH:', error); }
                } else {
                    console.log('⏳ Reconectando en 5 segundos...');
                }

                botStarting = false;
                scheduleReconnect();
                return;
            }

            if (connection === 'open') {
                console.log('✅ WHATSAPP CONECTADO CORRECTAMENTE');
                qrImage = '';
                botStarting = false;
            }
        });

        // ==================================================
        // SISTEMA DE BIENVENIDAS Y DESPEDIDAS
        // ==================================================
        sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id, participants, action } = update;
                const db = loadDB();
                
                if (!db.grupos || !db.grupos[id]) return;
                const config = db.grupos[id];

                for (const participant of participants) {
                    if (action === 'add' && config.welcome) {
                        let text = config.welcomeMsg || '¡Bienvenido(a) al grupo @usuario!';
                        text = text.replace(/@usuario/gi, `@${participant.split('@')[0]}`);
                        const imgPath = path.join(DATA_DIR, `welcome_${id.split('@')[0]}.jpg`);
                        
                        if (fs.existsSync(imgPath)) {
                            await sock.sendMessage(id, { image: { url: imgPath }, caption: text, mentions: [participant] });
                        } else {
                            await sock.sendMessage(id, { text: text, mentions: [participant] });
                        }
                    }

                    if (action === 'remove' && config.bye) {
                        let text = config.byeMsg || '¡Adiós @usuario, te extrañaremos!';
                        text = text.replace(/@usuario/gi, `@${participant.split('@')[0]}`);
                        const imgPath = path.join(DATA_DIR, `bye_${id.split('@')[0]}.jpg`);
                        
                        if (fs.existsSync(imgPath)) {
                            await sock.sendMessage(id, { image: { url: imgPath }, caption: text, mentions: [participant] });
                        } else {
                            await sock.sendMessage(id, { text: text, mentions: [participant] });
                        }
                    }
                }
            } catch (e) { console.error('❌ Error enviando Bienvenida/Despedida:', e); }
        });

        // ==================================================
        // LECTURA DE MENSAJES
        // ==================================================
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            try {
                if (type !== 'notify') return;
                const m = messages[0];
                if (!m || !m.message || m.key.fromMe) return;

                const from = m.key.remoteJid;
                if (!from) return;

                const isGroup = from.endsWith('@g.us');
                const sender = isGroup ? m.key.participant : from;
                const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || '';
                
                if (!body.startsWith('.')) return;

                const args = body.slice(1).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                const db = loadDB();

                // ==================================================
                // VERIFICACIÓN: ¿EL BOT ES ADMIN?
                // ==================================================
                if (isGroup) {
                    try {
                        const metadata = await sock.groupMetadata(from);
                        const myJid = sock.user?.id || sock.authState?.creds?.me?.id;
                        
                        if (myJid && metadata && metadata.participants) {
                            const botBase = obtenerNumeroBase(myJid);
                            const botParticipant = metadata.participants.find(p => obtenerNumeroBase(p.id) === botBase);
                            
                            if (botParticipant && botParticipant.admin !== 'admin' && botParticipant.admin !== 'superadmin') {
                                return; 
                            }
                        }
                    } catch (error) { 
                        // Permitir mensaje si hay retraso de red
                    }
                }

                // ==================================================
                // VERIFICACIÓN: ¿EL USUARIO ES ADMIN?
                // ==================================================
                async function isAdmin() {
                    if (!isGroup) return false;
                    
                    try {
                        const metadata = await sock.groupMetadata(from);
                        const senderBase = obtenerNumeroBase(sender);
                        
                        const participant = metadata.participants.find(p => obtenerNumeroBase(p.id) === senderBase);
                        return (participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
                    } catch (error) {
                        return false;
                    }
                }

                async function descargarImagen(msgObj) {
                    let mediaMessage = null;
                    if (msgObj.message?.imageMessage) {
                        mediaMessage = msgObj.message.imageMessage;
                    } else if (msgObj.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        mediaMessage = msgObj.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    }
                    if (mediaMessage) {
                        const stream = await downloadContentFromMessage(mediaMessage, 'image');
                        let buffer = Buffer.from([]);
                        for await(const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        return buffer;
                    }
                    return null;
                }

                // ==================================================
                // COMANDOS DINÁMICOS PERSONALIZADOS
                // ==================================================
                const comandosExtra = ['diamantes', 'actas', 'rfc', 'seguidores', 'ofertas', 'certificados', 'infonavit', 'imss'];
                const comandosSetExtra = comandosExtra.map(c => 'set' + c);

                // Si es un comando público extra (ej. .diamantes, .actas)
                if (comandosExtra.includes(command)) {
                    let text = db.textos[command] || `❌ Aún no hay información configurada para *${command.toUpperCase()}*.\n(Un admin debe configurarlo usando *.set${command}*).`;
                    const imgPath = path.join(DATA_DIR, `img_${command}.jpg`);
                    
                    if (fs.existsSync(imgPath)) {
                        await sock.sendMessage(from, { image: { url: imgPath }, caption: text }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { text: text }, { quoted: m });
                    }
                    return; // Terminamos aquí
                }

                // Si es un comando de configuración extra (ej. .setdiamantes, .setactas)
                if (comandosSetExtra.includes(command)) {
                    if (!(await isAdmin())) return;
                    
                    const baseCmd = command.substring(3); // Le quitamos la palabra "set" (ej. setdiamantes -> diamantes)
                    const textoNuevo = args.join(' ');
                    
                    if (textoNuevo) {
                        db.textos[baseCmd] = textoNuevo;
                    }

                    const buffer = await descargarImagen(m);
                    if (buffer) {
                        fs.writeFileSync(path.join(DATA_DIR, `img_${baseCmd}.jpg`), buffer);
                    }

                    // Si no mandó texto ni imagen, avisamos
                    if (!textoNuevo && !buffer && !db.textos[baseCmd]) {
                        return sock.sendMessage(from, { text: `❌ Debes enviar información o una foto. Ejemplo: *.${command} Precios de los diamantes...*` }, { quoted: m });
                    }

                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Información de *${baseCmd.toUpperCase()}* actualizada correctamente.` }, { quoted: m });
                    return; // Terminamos aquí
                }

                // ==================================================
                // COMANDOS DE LA TIENDA
                // ==================================================
                if (command === 'ayuda' || command === 'comandos') {
                    let text = `🤖 *LISTA DE COMANDOS - TIENDA SAMANTHA*\n\n`;
                    text += `👤 *Comandos Públicos:*\n`;
                    text += `• *.menu / .tienda* - Catálogo de productos.\n`;
                    text += `• *.stock* - Ver la cantidad disponible.\n`;
                    text += `• *.saldo* - Revisar cuánto dinero tienes.\n`;
                    text += `• *.comprar <producto>* - Adquirir una cuenta.\n`;
                    text += `• *.pago* - Ver depósitos/transferencias.\n`;
                    text += `• *.soporte* - Contactar a administración.\n`;
                    text += `• *.diamantes / .actas / .rfc / .seguidores*\n`;
                    text += `• *.ofertas / .certificados / .infonavit / .imss*\n\n`;
                    text += `👑 *Solo Administradores del Grupo:*\n`;
                    text += `• *.versaldo <@usuario>* - Ver saldo de un cliente.\n`;
                    text += `• *.historial <@usuario>* - Ver plataformas compradas.\n`;
                    text += `• *.addsaldo <@usuario> <cantidad>* - Recargar saldo.\n`;
                    text += `• *.removesaldo <@usuario> <cantidad>* - Descontar saldo.\n`;
                    text += `• *.setprecio <producto> <precio>* - Modificar precios.\n`;
                    text += `• *.addstock <producto> <datos>* - Subir inventario.\n`;
                    text += `• *.delstock <producto>* - Vaciar inventario de un producto.\n`;
                    text += `• *.setpago <clabe o info>* - Configurar cuenta bancaria.\n`;
                    text += `• *.set<comando> <texto/foto>* - Ej: *.setdiamantes*, *.setactas*\n`;
                    text += `• *.ventas* - Ver todas las compras globales.\n`;
                    text += `• *.abrir / .cerrar* - Manejo de chat del grupo.\n`;
                    text += `• *.todo <mensaje>* - Etiqueta a todos los del grupo.\n`;
                    text += `• *.promocion <texto>* - Lanza alerta masiva de ofertas.\n`;
                    text += `• *.welcome / .bye <on/off>* - Avisos de entrada/salida.\n`;
                    text += `• *.setwelcome / .setbye <texto/foto>* - Modifica avisos.\n`;
                    text += `• *.expulsar / .kick <@usuario>* - Eliminar a alguien del grupo.`;
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'soporte') {
                    let text = `🛠️ *Soporte - SAMANTHA LA HACKER*\n\nSi tuviste problemas con alguna suscripción de streaming, un trámite o requieres atención, comunícate directamente con la administración aquí:\n👉 wa.me/521XXXXXXXXXX`;
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'versaldo' || command === 'verbalance') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!mentioned) return sock.sendMessage(from, { text: '❌ Debes etiquetar a la persona. Ejemplo: *.versaldo @usuario*' }, { quoted: m });

                    const base = obtenerNumeroBase(mentioned);
                    let userSaldo = 0;
                    for (const key in db.saldos) {
                        if (obtenerNumeroBase(key) === base) {
                            userSaldo = db.saldos[key];
                            break;
                        }
                    }

                    await sock.sendMessage(from, {
                        text: `💰 *CONSULTA DE SALDO*\n\n👤 *Cliente:* @${mentioned.split('@')[0]}\n💵 *Saldo disponible:* $${userSaldo} MXN`,
                        mentions: [mentioned]
                    }, { quoted: m });
                }

                else if (command === 'historial' || command === 'compras') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!mentioned) return sock.sendMessage(from, { text: '❌ Debes etiquetar a la persona. Ejemplo: *.historial @usuario*' }, { quoted: m });

                    const base = obtenerNumeroBase(mentioned);
                    const comprasCliente = (db.ventas || []).filter(v => obtenerNumeroBase(v.comprador) === base);

                    if (comprasCliente.length === 0) {
                        return sock.sendMessage(from, {
                            text: `📁 @${mentioned.split('@')[0]} no registra compras en el sistema aún.`,
                            mentions: [mentioned]
                        }, { quoted: m });
                    }

                    let text = `📜 *HISTORIAL DE COMPRAS*\n👤 *Cliente:* @${mentioned.split('@')[0]}\n📦 *Total de compras:* ${comprasCliente.length}\n\n`;
                    const ultimas = comprasCliente.slice(-20); 
                    ultimas.forEach((v, i) => {
                        const fecha = new Date(v.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
                        text += `${i + 1}. *${v.producto.toUpperCase()}* - $${v.precio} MXN\n📅 ${fecha}\n\n`;
                    });

                    await sock.sendMessage(from, { text, mentions: [mentioned] }, { quoted: m });
                }

                else if (command === 'expulsar' || command === 'kick') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!mentioned) return sock.sendMessage(from, { text: '❌ Debes etiquetar a la persona que quieres expulsar.' }, { quoted: m });
                    
                    try {
                        await sock.groupParticipantsUpdate(from, [mentioned], "remove");
                        await sock.sendMessage(from, { text: '✅ Usuario expulsado del grupo exitosamente.' }, { quoted: m });
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ Hubo un error. ¿Asegúrate de que el bot sea Administrador?' }, { quoted: m });
                    }
                }

                else if (command === 'promocion' || command === 'oferta') {
                    if (!(await isAdmin())) return;
                    let promoText = args.join(' ');
                    if (!promoText) return sock.sendMessage(from, { text: '❌ Debes escribir el texto de la promoción.' }, { quoted: m });
                    
                    let text = `🚨 *¡NUEVA PROMOCIÓN!* 🚨\n\n${promoText}`;
                    const metadata = await sock.groupMetadata(from);
                    const members = metadata.participants.map(p => p.id);
                    await sock.sendMessage(from, { text: text, mentions: members });
                }

                else if (command === 'todo' || command === 'todos') {
                    if (!(await isAdmin())) return;
                    let text = args.length > 0 ? args.join(' ') : '📣 *¡ATENCIÓN A TODOS!*';
                    const metadata = await sock.groupMetadata(from);
                    const members = metadata.participants.map(p => p.id);
                    await sock.sendMessage(from, { text: text, mentions: members }, { quoted: m });
                }

                else if (command === 'welcome') {
                    if (!(await isAdmin())) return;
                    if (!db.grupos[from]) db.grupos[from] = {};
                    const estado = args[0]?.toLowerCase();
                    if (estado === 'on') {
                        db.grupos[from].welcome = true; saveDB(db);
                        await sock.sendMessage(from, { text: '✅ Bienvenidas ACTIVADAS en este grupo.' }, { quoted: m });
                    } else if (estado === 'off') {
                        db.grupos[from].welcome = false; saveDB(db);
                        await sock.sendMessage(from, { text: '❌ Bienvenidas DESACTIVADAS en este grupo.' }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { text: 'Usa: *.welcome on* o *.welcome off*' }, { quoted: m });
                    }
                }

                else if (command === 'bye') {
                    if (!(await isAdmin())) return;
                    if (!db.grupos[from]) db.grupos[from] = {};
                    const estado = args[0]?.toLowerCase();
                    if (estado === 'on') {
                        db.grupos[from].bye = true; saveDB(db);
                        await sock.sendMessage(from, { text: '✅ Despedidas ACTIVADAS en este grupo.' }, { quoted: m });
                    } else if (estado === 'off') {
                        db.grupos[from].bye = false; saveDB(db);
                        await sock.sendMessage(from, { text: '❌ Despedidas DESACTIVADAS en este grupo.' }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { text: 'Usa: *.bye on* o *.bye off*' }, { quoted: m });
                    }
                }

                else if (command === 'setwelcome') {
                    if (!(await isAdmin())) return;
                    if (!db.grupos[from]) db.grupos[from] = {};
                    const textoNuevo = args.join(' ');
                    if (textoNuevo) db.grupos[from].welcomeMsg = textoNuevo;

                    const buffer = await descargarImagen(m);
                    if (buffer) fs.writeFileSync(path.join(DATA_DIR, `welcome_${from.split('@')[0]}.jpg`), buffer);
                    saveDB(db);
                    await sock.sendMessage(from, { text: '✅ Configuración de Bienvenida guardada exitosamente.\n(Usa @usuario si quieres que el bot mencione a la persona).' }, { quoted: m });
                }

                else if (command === 'setbye') {
                    if (!(await isAdmin())) return;
                    if (!db.grupos[from]) db.grupos[from] = {};
                    const textoNuevo = args.join(' ');
                    if (textoNuevo) db.grupos[from].byeMsg = textoNuevo;

                    const buffer = await descargarImagen(m);
                    if (buffer) fs.writeFileSync(path.join(DATA_DIR, `bye_${from.split('@')[0]}.jpg`), buffer);
                    saveDB(db);
                    await sock.sendMessage(from, { text: '✅ Configuración de Despedida guardada exitosamente.\n(Usa @usuario si quieres que el bot mencione a la persona).' }, { quoted: m });
                }

                else if (command === 'menu' || command === 'tienda') {
                    let text = `🛒 *MENÚ DE TIENDA SAMANTHA*\n\n`;
                    text += `👤 *Tu Saldo:* $${db.saldos[sender] || 0} MXN\n\n📦 *Productos disponibles:*\n`;
                    const productos = Object.keys(db.precios);
                    if (productos.length === 0) text += `_No hay productos registrados aún._\n`;
                    else {
                        productos.forEach(producto => {
                            const precio = db.precios[producto];
                            const cantStock = (db.stock[producto] || []).length;
                            text += `• *${producto.toUpperCase()}* - $${precio} MXN (Stock: ${cantStock})\n`;
                        });
                    }
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'saldo') {
                    const saldo = db.saldos[sender] || 0;
                    await sock.sendMessage(from, { text: `💰 Tu saldo actual es: *$${saldo} MXN*` }, { quoted: m });
                }

                else if (command === 'stock') {
                    let text = `📦 *INVENTARIO DISPONIBLE:*\n\n`;
                    for (const producto in db.precios) {
                        const cant = (db.stock[producto] || []).length;
                        text += `• *${producto.toUpperCase()}*: ${cant} disponibles\n`;
                    }
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'pago') {
                    const infoPago = db.pago || "No hay datos bancarios registrados aún.";
                    const text = `${infoPago}\n\n*PAGOS DE TRANSFERENCIAS*`;
                    await sock.sendMessage(from, { text }, { quoted: m });
                }

                else if (command === 'setpago') {
                    if (!(await isAdmin())) return;
                    const clabe = args.join(' ');
                    if (!clabe) return sock.sendMessage(from, { text: '❌ Escribe la información bancaria después del comando.' }, { quoted: m });
                    db.pago = clabe; saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Datos de transferencia actualizados.` }, { quoted: m });
                }

                else if (command === 'ventas') {
                    if (!(await isAdmin())) return;
                    if (!db.ventas || db.ventas.length === 0) return sock.sendMessage(from, { text: '📈 Aún no se han registrado ventas en la base de datos.' }, { quoted: m });
                    let text = `📈 *ÚLTIMAS VENTAS REGISTRADAS*\n\n`;
                    const ultimasVentas = db.ventas.slice(-30); 
                    ultimasVentas.forEach((v, i) => {
                        const usuarioTag = v.comprador.split('@')[0];
                        const fechaVenta = new Date(v.fecha).toLocaleString('es-MX', {timeZone: 'America/Mexico_City'});
                        text += `${i + 1}. *${v.producto.toUpperCase()}* - $${v.precio} MXN\n👤 @${usuarioTag}\n📅 ${fechaVenta}\n\n`;
                    });
                    const menciones = ultimasVentas.map(v => v.comprador);
                    await sock.sendMessage(from, { text, mentions: menciones }, { quoted: m });
                }

                else if (command === 'abrir' || command === 'cerrar') {
                    if (!(await isAdmin())) return;
                    try {
                        const configuracion = command === 'abrir' ? 'not_announcement' : 'announcement';
                        await sock.groupSettingUpdate(from, configuracion);
                        await sock.sendMessage(from, { text: `✅ Grupo ${command === 'abrir' ? 'abierto.' : 'cerrado.'}` }, { quoted: m });
                    } catch (error) {
                        await sock.sendMessage(from, { text: '❌ Error. Asegúrate de que el Bot sea Administrador.' }, { quoted: m });
                    }
                }

                else if (command === 'comprar') {
                    const producto = args[0]?.toLowerCase();
                    if (!producto || !db.precios[producto]) return sock.sendMessage(from, { text: `❌ Producto no válido.` }, { quoted: m });
                    
                    const precio = db.precios[producto];
                    if ((db.saldos[sender] || 0) < precio) return sock.sendMessage(from, { text: `❌ Saldo insuficiente.` }, { quoted: m });
                    if (!db.stock[producto] || db.stock[producto].length === 0) return sock.sendMessage(from, { text: `❌ Producto agotado.` }, { quoted: m });

                    db.saldos[sender] -= precio;
                    const cuentaEntregada = db.stock[producto].shift();
                    
                    if (!db.ventas) db.ventas = [];
                    db.ventas.push({ comprador: sender, producto: producto, precio: precio, fecha: new Date().toISOString() });
                    saveDB(db);

                    await sock.sendMessage(from, {
                        text: `🎉 *¡COMPRA EXITOSA!*\n\n👤 *Entregado a:* @${sender.split('@')[0]}\n📦 *Producto:* ${producto.toUpperCase()}\n\n🔑 *Credenciales:*\n${cuentaEntregada}`,
                        mentions: [sender]
                    }, { quoted: m });
                }

                else if (command === 'addsaldo') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    const monto = parseInt(args[1] || args[0]);
                    if (!mentioned || isNaN(monto)) return;
                    db.saldos[mentioned] = (db.saldos[mentioned] || 0) + monto;
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Saldo actualizado.`, mentions: [mentioned] }, { quoted: m });
                }

                else if (command === 'removesaldo') {
                    if (!(await isAdmin())) return;
                    const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    const monto = parseInt(args[1] || args[0]);
                    if (!mentioned || isNaN(monto)) return;
                    
                    db.saldos[mentioned] = Math.max((db.saldos[mentioned] || 0) - monto, 0);
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Saldo descontado correctamente.`, mentions: [mentioned] }, { quoted: m });
                }

                else if (command === 'addstock') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();
                    const cuenta = args.slice(1).join(' ');
                    if (!producto || !cuenta) return;
                    if (!db.stock[producto]) db.stock[producto] = [];
                    db.stock[producto].push(cuenta);
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Stock actualizado.` }, { quoted: m });
                }

                else if (command === 'delstock') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();
                    if (!db.stock[producto]) return sock.sendMessage(from, { text: '❌ Producto no encontrado en el inventario.' }, { quoted: m });
                    
                    db.stock[producto] = [];
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Se ha vaciado todo el stock de *${producto.toUpperCase()}*.` }, { quoted: m });
                }

                else if (command === 'setprecio') {
                    if (!(await isAdmin())) return;
                    const producto = args[0]?.toLowerCase();
                    const precio = parseInt(args[1]);
                    if (!producto || isNaN(precio)) return;
                    db.precios[producto] = precio;
                    if (!db.stock[producto]) db.stock[producto] = [];
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Precio actualizado.` }, { quoted: m });
                }

            } catch (error) { console.error('❌ ERROR PROCESANDO MENSAJE:', error); }
        });

        botStarting = false;
    } catch (error) {
        botStarting = false;
        console.error('🔥 ERROR INICIANDO BAILEYS', error);
        setTimeout(() => { startBot(); }, 10000);
    }
}

startBot();
