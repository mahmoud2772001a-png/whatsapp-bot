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

    // ----------------------------------------------------
    // 1. الترحيب بالأعضاء الجدد عند انضمامهم للمجموعة
    // ----------------------------------------------------
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action === 'add') {
            for (let user of participants) {
                const welcomeText = `أهلاً بك يا غالي @${user.split('@')[0]} في المجموعة! منورنا، نتمنى لك أوقاتاً مفيدة معنا 🌹`;
                await sock.sendMessage(id, { text: welcomeText, mentions: [user] });
            }
        }
    });

    // ----------------------------------------------------
    // 2. مراقبة الرسائل (السلام، السب، الروابط، الملصقات، وإعلانات العمل)
    // ----------------------------------------------------
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        if (m.key.fromMe) return;

        const remoteJid = m.key.remoteJid;
        
        // التأكد أن الرسالة قادمة من مجموعة
        if (remoteJid.endsWith('@g.us')) {
            const messageType = Object.keys(m.message)[0];
            const messageText = m.message.conversation || 
                                m.message.extendedTextMessage?.text || '';

            // أداة مساعدة لحذف الرسالة المخالفة
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
                    console.log('فشل الحذف (تأكد أن البوت مشرف):', err);
                }
            };

            // أ) الرد التلقائي على السلام
            if (messageText.includes('السلام عليكم') || messageText.includes('سلام عليكم')) {
                await sock.sendMessage(remoteJid, { text: 'وعليكم السلام ورحمة الله وبركاته، أهلاً بك يا هلا!' });
                return;
            }

            // ب) قائمة الكلمات النابية أو السب والشتم (يمكنك تعديلها وإضافة كلمات أخرى)
            const badWords = ['شتم1', 'شتم2', 'كلمة_نابية']; // ضع الكلمات الممنوعة هنا
            const hasBadWord = badWords.some(word => messageText.includes(word));
            if (hasBadWord) {
                await deleteMessage();
                console.log('تم حذف رسالة تحتوي على سب/شتم');
                return;
            }

            // ج) إعلانات العمل والسبام المشبوهة
            const jobSpamKeywords = ['وظيفة عن بعد', 'ربح سريع', 'دخل يومي', 'استثمار مضمون', 'تداول بربح', 'فرصة عمل خيالية', 'رأس مال بسيط'];
            const isJobSpam = jobSpamKeywords.some(keyword => messageText.includes(keyword));
            if (isJobSpam) {
                await deleteMessage();
                console.log('تم حذف إعلان عمل مشبوه/سبام');
                return;
            }

            // د) فحص الروابط
            const hasLink = /https?:\/\/[^\s]+|www\.[^\s]+/.test(messageText);

            // هـ) فحص الملصقات
            const isSticker = messageType === 'stickerMessage';

            // الحذف إذا كان رابطاً أو ملصقاً
            if (hasLink || isSticker) {
                await deleteMessage();
                console.log('تم حذف رابط أو ملصق');
            }
        }
    });

    // ----------------------------------------------------
    // 3. جدولة إغلاق المجموعة تلقائياً يومياً الساعة 10:30 مساءً (بتوقيت فلسطين)
    // ----------------------------------------------------
    setInterval(async () => {
        const now = new Date();
        // ملاحظة: سيرفرات Render تعمل بتوقيت UTC. الساعة 10:30 مساءً بتوقيت فلسطين (توقيت شتوي UTC+2) تعني الساعة 20:30 UTC.
        const hours = now.getUTCHours() + 2; // تعديل حسب توقيت فلسطين
        const minutes = now.getUTCMinutes();

        // حدد هنا Jid المجموعات الخاصة بك التي تريد إغلاقها تلقائياً
        const targetGroupJid = '123456789-group@g.us'; // استبدل هذا بـ Jid المجموعة الحقيقي

        if (hours === 22 && minutes === 30) {
            try {
                // إغلاق المجموعة بحيث لا يرسل الرسائل إلا المشرفون ('announcement')
                await sock.groupSettingUpdate(targetGroupJid, 'announcement');
                await sock.sendMessage(targetGroupJid, { text: 'تم إغلاق المجموعة تلقائياً لليلة. تصبحون على خير 🌙' });
                console.log('تم إغلاق المجموعة بنجاح في 10:30 مساءً');
            } catch (error) {
                console.log('فشل إغلاق المجموعة:', error);
            }
        }
    }, 60000); // يفحص الوقت كل دقيقة
}

connectToWhatsApp();
