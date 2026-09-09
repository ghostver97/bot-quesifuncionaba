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

// Cuando montemos el Volume de Railway,
// RAILWAY_VOLUME_MOUNT_PATH apuntará al disco.
// Mientras tanto utilizamos /app/data.
const DATA_DIR =
    process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';

const AUTH_DIR =
    path.join(DATA_DIR, 'auth_info_baileys');

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

// Página principal
app.get('/', (req, res) => {

    if (qrImage) {

        res.send(`
<!DOCTYPE html>
<html lang="es">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <meta
        http-equiv="refresh"
        content="10"
    >

    <title>Bot Tienda Samantha</title>

    <style>

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;

            min-height: 100vh;

            display: flex;
            align-items: center;
            justify-content: center;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

            background:
                linear-gradient(
                    135deg,
                    #111827,
                    #1f2937
                );

            color: #111827;
        }

        .card {
            width: 90%;
            max-width: 450px;

            background: white;

            padding: 30px;

            border-radius: 20px;

            text-align: center;

            box-shadow:
                0 20px 50px
                rgba(0,0,0,0.35);
        }

        h1 {
            margin-top: 0;
            font-size: 25px;
        }

        img {
            width: 280px;
            height: 280px;

            max-width: 100%;

            margin: 15px 0;

            border-radius: 10px;
        }

        .success {
            color: #16a34a;
            font-weight: bold;
        }

        .info {
            color: #666;
            font-size: 14px;
        }

    </style>

</head>

<body>

    <div class="card">

        <h1>
            📱 Vincular Bot WhatsApp
        </h1>

        <p>
            Escanea este código QR
            desde WhatsApp.
        </p>

        <img
            src="${qrImage}"
            alt="Código QR de WhatsApp"
        >

        <p class="success">
            🟢 QR generado correctamente
        </p>

        <p class="info">
            El código se actualiza automáticamente.
        </p>

        <p class="info">
            Bot Tienda Samantha Online 24/7 🚀
        </p>

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

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <meta
        http-equiv="refresh"
        content="5"
    >

    <title>Bot Tienda Samantha</title>

</head>

<body
    style="
        margin:0;
        min-height:100vh;
        display:flex;
        align-items:center;
        justify-content:center;
        font-family:Arial, sans-serif;
        background:#f4f4f9;
        text-align:center;
    "
>

    <div>

        <h1>
            🤖 Bot Tienda Samantha Online 24/7 🚀
        </h1>

        <p>
            <b>Estado:</b>
            conectando con WhatsApp...
        </p>

        <p>
            El QR aparecerá automáticamente.
        </p>

        <p>
            🔄 Recargando...
        </p>

    </div>

</body>

</html>
        `);
    }
});

// Health check
app.get('/health', (req, res) => {

    res.json({
        ok: true,
        bot: 'Tienda Samantha',
        qr: !!qrImage,
        time: new Date().toISOString()
    });

});

app.listen(PORT, () => {

    console.log(
        `🌐 Servidor Express activo en puerto ${PORT}`
    );

});

// ======================================================
// BASE DE DATOS
// ======================================================

function loadDB() {

    if (!fs.existsSync(DB_FILE)) {

        const initialData = {
            saldos: {},
            stock: {},
            precios: {}
        };

        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(
                initialData,
                null,
                2
            )
        );

        console.log(
            '🗄️ db.json creado correctamente.'
        );

        return initialData;
    }

    try {

        return JSON.parse(
            fs.readFileSync(
                DB_FILE,
                'utf-8'
            )
        );

    } catch (error) {

        console.error(
            '❌ ERROR LEYENDO db.json:',
            error
        );

        return {
            saldos: {},
            stock: {},
            precios: {}
        };
    }
}

function saveDB(data) {

    try {

        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(
                data,
                null,
                2
            )
        );

    } catch (error) {

        console.error(
            '❌ ERROR GUARDANDO db.json:',
            error
        );
    }
}

// ======================================================
// CONTROL DE RECONEXIÓN
// ======================================================

let reconnectTimer = null;

let botStarting = false;

function scheduleReconnect(delay = 5000) {

    if (reconnectTimer) {
        return;
    }

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
        console.log(
            '⚠️ El bot ya se está iniciando.'
        );

        return;
    }

    botStarting = true;

    try {

        console.log('');
        console.log('========================================');
        console.log('🚀 INICIANDO BAILEYS');
        console.log('========================================');

        // Crear carpeta auth
        if (!fs.existsSync(AUTH_DIR)) {

            fs.mkdirSync(
                AUTH_DIR,
                {
                    recursive: true
                }
            );

            console.log(
                '📁 Carpeta de autenticación creada.'
            );
        }

        // ==================================================
        // AUTENTICACIÓN
        // ==================================================

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(
            AUTH_DIR
        );

        console.log(
            '🔐 Estado de autenticación cargado.'
        );

        // ==================================================
        // VERSIÓN ACTUAL DE WHATSAPP WEB
        // ==================================================

        const {
            version,
            isLatest
        } = await fetchLatestWaWebVersion();

        console.log(
            '📱 Versión REAL de WhatsApp Web:',
            version.join('.')
        );

        console.log(
            '⭐ ¿Es la última versión?:',
            isLatest
        );

        // ==================================================
        // CREAR SOCKET
        // ==================================================

        const sock = makeWASocket({

            version,

            logger: pino({
                level: 'debug'
            }),

            auth: state,

            printQRInTerminal: false,

            browser: Browsers.ubuntu(
                'Chrome'
            ),

            connectTimeoutMs: 60000,

            defaultQueryTimeoutMs: undefined,

            keepAliveIntervalMs: 30000,

            markOnlineOnConnect: false

        });

        // ==================================================
        // GUARDAR CREDENCIALES
        // ==================================================

        sock.ev.on(
            'creds.update',
            saveCreds
        );

        // ==================================================
        // ACTUALIZACIÓN DE CONEXIÓN
        // ==================================================

        sock.ev.on(
            'connection.update',
            async (update) => {

                const {
                    connection,
                    lastDisconnect,
                    qr
                } = update;

                // ==========================================
                // QR
                // ==========================================

                if (qr) {

                    console.log('');
                    console.log(
                        '========================================'
                    );

                    console.log(
                        '📱 QR RECIBIDO DE WHATSAPP'
                    );

                    console.log(
                        '========================================'
                    );

                    try {

                        qrImage =
                            await QRCode.toDataURL(
                                qr
                            );

                        console.log(
                            '✅ QR convertido a imagen correctamente.'
                        );

                        console.log(
                            '🌐 Abre la URL pública de Railway.'
                        );

                    } catch (error) {

                        console.error(
                            '❌ ERROR GENERANDO QR:',
                            error
                        );
                    }
                }

                // ==========================================
                // CONEXIÓN CERRADA
                // ==========================================

                if (connection === 'close') {

                    qrImage = '';

                    const error =
                        lastDisconnect?.error;

                    const statusCode =
                        error?.output?.statusCode;

                    console.log('');
                    console.log(
                        '========================================'
                    );

                    console.error(
                        '❌ CONEXIÓN WHATSAPP CERRADA'
                    );

                    console.log(
                        '========================================'
                    );

                    console.error(
                        'Código:',
                        statusCode
                    );

                    console.error(
                        'Mensaje:',
                        error?.message
                    );

                    console.error(
                        'Error completo:',
                        error
                    );

                    // ======================================
                    // SESIÓN CERRADA / LOGOUT
                    // ======================================

                    if (
                        statusCode ===
                        DisconnectReason.loggedOut
                    ) {

                        console.log(
                            '🚪 WhatsApp cerró la sesión.'
                        );

                        console.log(
                            '🗑️ Eliminando credenciales...'
                        );

                        try {

                            if (
                                fs.existsSync(
                                    AUTH_DIR
                                )
                            ) {

                                fs.rmSync(
                                    AUTH_DIR,
                                    {
                                        recursive: true,
                                        force: true
                                    }
                                );

                            }

                        } catch (error) {

                            console.error(
                                '❌ ERROR ELIMINANDO AUTH:',
                                error
                            );
                        }

                        qrImage = '';

                        console.log(
                            '🔄 Se generará un QR nuevo.'
                        );

                    } else {

                        console.log(
                            '🔄 WhatsApp cerró la conexión.'
                        );

                        console.log(
                            '⏳ Reconectando en 5 segundos...'
                        );
                    }

                    botStarting = false;

                    scheduleReconnect();

                    return;
                }

                // ==========================================
                // CONECTADO
                // ==========================================

                if (connection === 'open') {

                    console.log('');
                    console.log(
                        '========================================'
                    );

                    console.log(
                        '✅ WHATSAPP CONECTADO CORRECTAMENTE'
                    );

                    console.log(
                        '========================================'
                    );

                    qrImage = '';

                    botStarting = false;
                }

            }
        );

        // ==================================================
        // MENSAJES
        // ==================================================

        sock.ev.on(
            'messages.upsert',
            async ({
                messages,
                type
            }) => {

                try {

                    if (
                        type !== 'notify'
                    ) {
                        return;
                    }

                    const m =
                        messages[0];

                    if (
                        !m ||
                        !m.message ||
                        m.key.fromMe
                    ) {
                        return;
                    }

                    const from =
                        m.key.remoteJid;

                    if (!from) {
                        return;
                    }

                    const isGroup =
                        from.endsWith(
                            '@g.us'
                        );

                    const sender =
                        isGroup
                            ? m.key.participant
                            : from;

                    const body =
                        m.message.conversation ||
                        m.message.extendedTextMessage?.text ||
                        '';

                    if (
                        !body.startsWith('.')
                    ) {
                        return;
                    }

                    const args =
                        body
                            .slice(1)
                            .trim()
                            .split(/ +/);

                    const command =
                        args
                            .shift()
                            .toLowerCase();

                    const db =
                        loadDB();

                    // ==================================================
                    // COMPROBAR ADMIN
                    // ==================================================

                    async function isAdmin() {

                        if (!isGroup) {
                            return false;
                        }

                        try {

                            const metadata =
                                await sock.groupMetadata(
                                    from
                                );

                            const participant =
                                metadata.participants.find(
                                    p =>
                                        p.id ===
                                        sender
                                );

                            return (
                                participant &&
                                (
                                    participant.admin ===
                                        'admin' ||
                                    participant.admin ===
                                        'superadmin'
                                )
                            );

                        } catch (error) {

                            console.error(
                                '❌ ERROR COMPROBANDO ADMIN:',
                                error
                            );

                            return false;
                        }
                    }

                    // ==================================================
                    // .MENU / .TIENDA
                    // ==================================================

                    if (
                        command === 'menu' ||
                        command === 'tienda'
                    ) {

                        let text =
                            `🛒 *MENÚ DE TIENDA SAMANTHA*\n\n`;

                        text +=
                            `👤 *Tu Saldo:* $${db.saldos[sender] || 0} MXN\n\n`;

                        text +=
                            `📦 *Productos disponibles:*\n`;

                        const productos =
                            Object.keys(
                                db.precios
                            );

                        if (
                            productos.length === 0
                        ) {

                            text +=
                                `_No hay productos registrados aún._\n`;

                        } else {

                            productos.forEach(
                                producto => {

                                    const precio =
                                        db.precios[
                                            producto
                                        ];

                                    const cantStock =
                                        (
                                            db.stock[
                                                producto
                                            ] || []
                                        ).length;

                                    text +=
                                        `• *${producto.toUpperCase()}* - $${precio} MXN (Stock: ${cantStock})\n`;
                                }
                            );
                        }

                        await sock.sendMessage(
                            from,
                            {
                                text
                            },
                            {
                                quoted: m
                            }
                        );
                    }

                    // ==================================================
                    // .SALDO
                    // ==================================================

                    else if (
                        command === 'saldo'
                    ) {

                        const saldo =
                            db.saldos[
                                sender
                            ] || 0;

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `💰 Tu saldo actual es: *$${saldo} MXN*`
                            },
                            {
                                quoted: m
                            }
                        );
                    }

                    // ==================================================
                    // .STOCK
                    // ==================================================

                    else if (
                        command === 'stock'
                    ) {

                        let text =
                            `📦 *INVENTARIO DISPONIBLE:*\n\n`;

                        for (
                            const producto in
                            db.precios
                        ) {

                            const cant =
                                (
                                    db.stock[
                                        producto
                                    ] || []
                                ).length;

                            text +=
                                `• *${producto.toUpperCase()}*: ${cant} disponibles\n`;
                        }

                        await sock.sendMessage(
                            from,
                            {
                                text
                            },
                            {
                                quoted: m
                            }
                        );
                    }

                    // ==================================================
                    // .COMPRAR
                    // ==================================================

                    else if (
                        command === 'comprar'
                    ) {

                        const producto =
                            args[0]?.toLowerCase();

                        if (
                            !producto ||
                            !db.precios[
                                producto
                            ]
                        ) {

                            return sock.sendMessage(
                                from,
                                {
                                    text:
                                        `❌ Producto no válido o no existe.`
                                },
                                {
                                    quoted: m
                                }
                            );
                        }

                        const precio =
                            db.precios[
                                producto
                            ];

                        const userSaldo =
                            db.saldos[
                                sender
                            ] || 0;

                        if (
                            userSaldo < precio
                        ) {

                            return sock.sendMessage(
                                from,
                                {
                                    text:
                                        `❌ Saldo insuficiente.`
                                },
                                {
                                    quoted: m
                                }
                            );
                        }

                        if (
                            !db.stock[
                                producto
                            ] ||
                            db.stock[
                                producto
                            ].length === 0
                        ) {

                            return sock.sendMessage(
                                from,
                                {
                                    text:
                                        `❌ Producto agotado.`
                                },
                                {
                                    quoted: m
                                }
                            );
                        }

                        db.saldos[
                            sender
                        ] -= precio;

                        const cuentaEntregada =
                            db.stock[
                                producto
                            ].shift();

                        saveDB(db);

                        await sock.sendMessage(
                            sender,
                            {
                                text:
                                    `🎉 *¡COMPRA EXITOSA!*\n\n` +
                                    `📦 *Producto:* ${producto.toUpperCase()}\n\n` +
                                    `🔑 *Credenciales:*\n${cuentaEntregada}`
                            }
                        );

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ Compra realizada. Te enviamos las credenciales por mensaje privado.`
                            },
                            {
                                quoted: m
                            }
                        );
                    }

                    // ==================================================
                    // .ADDSALDO
                    // ==================================================

                    else if (
                        command === 'addsaldo'
                    ) {

                        if (
                            !(await isAdmin())
                        ) {
                            return;
                        }

                        const mentioned =
                            m.message
                                .extendedTextMessage
                                ?.contextInfo
                                ?.mentionedJid
                                ?.[0];

                        const monto =
                            parseInt(
                                args[1] ||
                                args[0]
                            );

                        if (
                            !mentioned ||
                            isNaN(monto)
                        ) {
                            return;
                        }

                        db.saldos[
                            mentioned
                        ] =
                            (
                                db.saldos[
                                    mentioned
                                ] || 0
                            ) + monto;

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ Saldo actualizado.`,
                                mentions: [
                                    mentioned
                                ]
                            },
                            {
                                quoted: m
                            }
                        );
                    }

                    // ==================================================
                    // .ADDSTOCK
                    // ==================================================

                    else if (
                        command === 'addstock'
                    ) {

                        if (
                            !(await isAdmin())
                        ) {
                            return;
                        }

                        const producto =
                            args[0]
                                ?.toLowerCase();

                        const cuenta =
                            args
                                .slice(1)
                                .join(' ');

                        if (
                            !producto ||
                            !cuenta
                        ) {
                            return;
                        }

                        if (
                            !db.stock[
                                producto
                            ]
                        ) {

                            db.stock[
                                producto
                            ] = [];
                        }

                        db.stock[
                            producto
                        ].push(
                            cuenta
                        );

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ Stock actualizado.`
                            },
                            {
                                quoted: m
                            }
                        );
                    }

                    // ==================================================
                    // .SETPRECIO
                    // ==================================================

                    else if (
                        command === 'setprecio'
                    ) {

                        if (
                            !(await isAdmin())
                        ) {
                            return;
                        }

                        const producto =
                            args[0]
                                ?.toLowerCase();

                        const precio =
                            parseInt(
                                args[1]
                            );

                        if (
                            !producto ||
                            isNaN(precio)
                        ) {
                            return;
                        }

                        db.precios[
                            producto
                        ] = precio;

                        if (
                            !db.stock[
                                producto
                            ]
                        ) {

                            db.stock[
                                producto
                            ] = [];
                        }

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ Precio actualizado.`
                            },
                            {
                                quoted: m
                            }
                        );
                    }

                } catch (error) {

                    console.error(
                        '❌ ERROR PROCESANDO MENSAJE:',
                        error
                    );
                }

            }
        );

        botStarting = false;

    } catch (error) {

        botStarting = false;

        console.error('');
        console.error(
            '========================================'
        );

        console.error(
            '🔥 ERROR INICIANDO BAILEYS'
        );

        console.error(
            '========================================'
        );

        console.error(
            error
        );

        console.error(
            'Mensaje:',
            error?.message
        );

        console.error(
            'Stack:',
            error?.stack
        );

        console.log(
            '🔄 Reintentando en 10 segundos...'
        );

        setTimeout(() => {

            startBot();

        }, 10000);
    }
}

// ======================================================
// INICIAR
// ======================================================

startBot();
