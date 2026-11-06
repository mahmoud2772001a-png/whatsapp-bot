const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

async function connectToWhatsApp() {
    console.log('جاري الاتصال بخوادم واتساب...');
    const { state, saveCreds } = await useMultiFileAuthState('session_new_bot');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('انقطع الاتصال، جاري إعادة المحاولة...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('تم اتصال البوت بنجاح تام! 🎉');
        }
    });

    // طلب كود الربط برقم الهاتف مباشرة
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = "970569530453"; // رقمك
                console.log('جاري طلب كود الربط الآن...');
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(` كود الربط الخاص بك هو: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.log('خطأ في طلب كود الربط:', error);
            }
        }, 6000);
    }
}

connectToWhatsApp();
