const http = require('http');
http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 3000);

const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const groupSlowModes = new Map();
const userCooldowns = new Map();
const userWarnings = new Map();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_session');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log('📌 مسح الباركود الجديد:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('✅ البوت متصل بنجاح ويعمل بشكل سليم وآمن!');
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            if (chatUpdate.type !== 'notify') return;

            const mek = chatUpdate.messages[0];
            if (!mek || !mek.message || mek.key.fromMe) return;

            const jid = mek.key.remoteJid;
            if (!jid || !jid.endsWith('@g.us')) return;

            const sender = mek.key.participant || mek.participant;
            const messageType = Object.keys(mek.message)[0];

            let isAdmin = false;
            try {
                const metadata = await sock.groupMetadata(jid);
                const participantObj = metadata.participants.find(p => p.id === sender);
                if (participantObj) {
                    isAdmin = participantObj.admin === 'admin' || participantObj.admin === 'superadmin';
                }
            } catch (e) {}

            const msgContent = mek.message;
            const body = msgContent.conversation || 
                         msgContent.extendedTextMessage?.text || 
                         msgContent.imageMessage?.caption || '';

            if (messageType === 'stickerMessage' && !isAdmin) {
                await sock.sendMessage(jid, { delete: mek.key });
                return;
            }

            if (isAdmin) {
                if (body.startsWith('!بطيء ')) {
                    const args = body.split(' ');
                    const secs = parseInt(args[1]);
                    if (!isNaN(secs)) {
                        groupSlowModes.set(jid, secs);
                        await sock.sendMessage(jid, { text: `✅ تم تفعيل الوضع البطيء بمدّة ${secs} ثانية.` });
                        return;
                    }
                } else if (body === '!إيقاف البطيء') {
                    groupSlowModes.delete(jid);
                    await sock.sendMessage(jid, { text: `🚫 تم إلغاء الوضع البطيء في المجموعة.` });
                    return;
                }
                return;
            }

            if (body.trim() === 'قوانين' || body.trim() === '!قوانين') {
                const rulesText = `📌 *قوانين المجموعة:*\n` +
                                  `1️⃣ ممنوع إرسال الروابط (3 تحذيرات ثم إزالة).\n` +
                                  `2️⃣ الملصقات ممنوعة وتُحذف تلقائياً.\n` +
                                  `3️⃣ الالتزام بتعليمات الإدارة.`;
                await sock.sendMessage(jid, { text: rulesText });
                return;
            }

            const strictUrlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/i;
            if (strictUrlRegex.test(body)) {
                await sock.sendMessage(jid, { delete: mek.key });

                const warnKey = `${jid}_${sender}`;
                const currentWarnings = (userWarnings.get(warnKey) || 0) + 1;
                userWarnings.set(warnKey, currentWarnings);

                if (currentWarnings >= 3) {
                    await sock.sendMessage(jid, { text: `⚠️ @${sender.split('@')[0]} تم إزالتك لتجاوزك حد نشر الروابط (3 تحذيرات).`, mentions: [sender] });
                    try {
                        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
                    } catch (err) {}
                    userWarnings.delete(warnKey);
                } else {
                    await sock.sendMessage(jid, { text: `⚠️ @${sender.split('@')[0]} ممنوع إرسال الروابط! التحذير (${currentWarnings}/3).`, mentions: [sender] });
                }
                return;
            }

            const slowModeSeconds = groupSlowModes.get(jid);
            if (slowModeSeconds) {
                const userKey = `${jid}_${sender}`;
                const now = Date.now();
                const lastTime = userCooldowns.get(userKey) || 0;
                const diff = (now - lastTime) / 1000;

                if (diff < slowModeSeconds) {
                    await sock.sendMessage(jid, { delete: mek.key });
                    return;
                }
                userCooldowns.set(userKey, now);
            }

        } catch (err) {
            console.log("خطأ:", err.message);
        }
    });
}

startBot();