process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Promesa rechazada:', reason);
});

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const pino = require('pino');
const QRCode = require('qrcode');

let qrImage = '';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    if (qrImage) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>QR Bot WhatsApp</title>
                <meta http-equiv="refresh" content="10">
                <style>
                    body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #f4f4f9; margin: 0; }
                    .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); text-align: center; }
                    img { width: 280px; height: 280px; margin: 15px 0; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Escanea el QR para vincular el Bot</h2>
                    <img src="${qrImage}" alt="QR Code"/>
                    <p>Bot Tienda Samantha Online 24/7 🚀</p>
                    <small style="color: gray;">Actualización automática cada 10s</small>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
                <h2>Bot Tienda Samantha Online 24/7 🚀</h2>
                <p>El bot está <b>conectado</b> o generando el QR... (Recarga en unos segundos)</p>
            </div>
        `);
    }
});

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));

const DB_FILE = './db.json';

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { saldos: {}, stock: {}, precios: {} };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch (e) {
        return { saldos: {}, stock: {}, precios: {} };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        version: [2, 3000, 1015901307], // Versión fija para evitar bloqueos de red con GitHub
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrImage = await QRCode.toDataURL(qr);
            console.log('⚡ QR Generado correctamente.');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('❌ Conexión cerrada. Código:', statusCode);

            if (statusCode === DisconnectReason.loggedOut) {
                if (fs.existsSync('./auth_info_baileys')) {
                    fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
                }
            }

            setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrImage = '';
            console.log('✅ Bot conectado exitosamente a WhatsApp.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = isGroup ? m.key.participant : from;

        const body = m.message.conversation ||
                     m.message.extendedTextMessage?.text || '';

        if (!body.startsWith('.')) return;

        const args = body.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const db = loadDB();

        async function isAdmin() {
            if (!isGroup) return false;
            try {
                const metadata = await sock.groupMetadata(from);
                const participant = metadata.participants.find(p => p.id === sender);
                return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            } catch (e) {
                return false;
            }
        }

        if (command === 'menu' || command === 'tienda') {
            let text = `🛒 *MENÚ DE TIENDA SAMANTHA*\n\n`;
            text += `👤 *Tu Saldo:* $${db.saldos[sender] || 0} MXN\n\n`;
            text += `📦 *Productos disponibles:*\n`;

            const productos = Object.keys(db.precios);
            if (productos.length === 0) {
                text += `_No hay productos registrados aún._\n`;
            } else {
                productos.forEach(p => {
                    const precio = db.precios[p];
                    const cantStock = (db.stock[p] || []).length;
                    text += `• *${p.toUpperCase()}* - $${precio} MXN (Stock: ${cantStock})\n`;
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
            for (const p in db.precios) {
                const cant = (db.stock[p] || []).length;
                text += `• *${p.toUpperCase()}*: ${cant} disponibles\n`;
            }
            await sock.sendMessage(from, { text }, { quoted: m });
        }
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
            saveDB(db);

            await sock.sendMessage(sender, {
                text: `🎉 *¡COMPRA EXITOSA!*\n📦 *Producto:* ${producto.toUpperCase()}\n🔑 *Credenciales:*\n${cuentaEntregada}`
            });
            await sock.sendMessage(from, {
                text: `✅ Compra realizada. Te enviamos las credenciales por mensaje privado.`
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
    });
}

startBot();