const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');

// إعداد خادم بسيط لضمان بقاء البوت شغّالاً 24/7 على Render
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session_wa_2');
    
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
            console.log('Connection closed, reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Bot connected successfully!');
        }
    });

    // طلب كود الربط برقم الهاتف تلقائياً
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = "970569530453"; // رقمك الشخصي
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(` كود الربط الخاص بك هو: ${code}`);
                console.log(`========================================\n`);
            } catch (error) {
                console.log('خطأ في طلب كود الربط:', error);
            }
        }, 5000);
    }

    // 1. ترحيب بالأعضاء الجدد
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action === 'add') {
            for (let user of participants) {
                const welcomeText = `أهلاً بك يا غالي @${user.split('@')[0]} في المجموعة! منورنا، نتمنى لك أوقاتاً مفيدة معنا 🌹`;
                await sock.sendMessage(id, { text: welcomeText, mentions: [user] });
            }
        }
    });

    // 2. مراقبة الرسائل (السلام، الروابط، الملصقات، السبام)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        if (m.key.fromMe) return;

        const remoteJid = m.key.remoteJid;
        
        if (remoteJid.endsWith('@g.us')) {
            const messageType = Object.keys(m.message)[0];
            const messageText = m.message.conversation || 
                                m.message.extendedTextMessage?.text || '';

            const deleteMessage = async () => {
                try {
                    await sock.sendMessage(remoteJid, { 
                        delete: { 
                            remoteJid: remoteJid, 
                            fromMe: false, 
                            id: m.key.id, 
                            participant: m.key.participant || m.participant 
                        } 
                    });
                } catch (err) {
                    console.log('فشل الحذف:', err);
                }
            };

            // أ) الرد التلقائي على السلام
            if (messageText.includes('السلام عليكم') || messageText.includes('سلام عليكم')) {
                await sock.sendMessage(remoteJid, { text: 'وعليكم السلام ورحمة الله وبركاته، أهلاً بك يا غالي!' });
                return;
            }

            // ب) الروابط والملصقات وإعلانات العمل المشبوهة
            const hasLink = /https?:\/\/[^\s]+|www\.[^\s]+/.test(messageText);
            const isSticker = messageType === 'stickerMessage';
            const jobSpamKeywords = ['وظيفة عن بعد', 'ربح سريع', 'دخل يومي', 'استثمار مضمون', 'تداول بربح'];
            const isJobSpam = jobSpamKeywords.some(kw => messageText.includes(kw));

            if (hasLink || isSticker || isJobSpam) {
                await deleteMessage();
            }
        }
    });
}

connectToWhatsApp();
