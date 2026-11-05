const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const cron = require("node-cron");

const warnings = {};

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("whatsapp_session");
  const sock = makeWASocket({ logger: pino({ level: "silent" }), auth: state });
  const GROUP_CODE = "CFkr2ow7mTc4TGXxge1Bwb";
  
  sock.ev.on("creds.update", saveCreds);
  
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      console.log("🟢 Bot is online, connected, and protecting the group!");
    } else if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("🔴 Disconnected. Reconnecting...", shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    }
  });

  cron.schedule("30 22 * * *", async () => {
    try {
      const group = await sock.groupGetInfoFromInvite(GROUP_CODE);
      await sock.groupSettingUpdate(group.id, "announcement");
      await sock.sendMessage(group.id, { text: "تم إغلاق المجموعة تلقائياً ليلًا 🌙" });
    } catch (e) {}
  });

  cron.schedule("0 7 * * *", async () => {
    try {
      const group = await sock.groupGetInfoFromInvite(GROUP_CODE);
      await sock.groupSettingUpdate(group.id, "not_announcement");
      await sock.sendMessage(group.id, { text: "صباح الخير! تم فتح المجموعة ☀️" });
    } catch (e) {}
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const m = messages[0];
      if (!m.message || m.key.fromMe) return;
      
      const jid = m.key.remoteJid;
      const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || "";
      
      const hasLink = /http|www|t\.me|wa\.me|bit\.ly|whatsapp\.com/i.test(text);
      
      if (hasLink) {
        const groupMetadata = await sock.groupMetadata(jid);
        const sender = m.key.participant || m.key.remoteJid;
        
        const participant = groupMetadata.participants.find(p => p.id === sender);
        const isAdmin = participant && (participant.admin === "admin" || participant.admin === "superadmin");
        
        if (isAdmin) return;

        await sock.sendMessage(jid, { delete: m.key });
        
        if (!warnings[sender]) warnings[sender] = 0;
        warnings[sender] += 1;
        const currentWarnings = warnings[sender];

        if (currentWarnings < 3) {
          await sock.sendMessage(jid, { 
            text: `عذراً @${sender.split("@")[0]}، ممنوع نشر الروابط! تحذير (${currentWarnings}/3). 🚫`, 
            mentions: [sender] 
          });
        } else {
          await sock.sendMessage(jid, { 
            text: `تمت إزالة العضو @${sender.split("@")[0]} لتكرار نشر الروابط! ❌`, 
            mentions: [sender] 
          });
          await sock.groupParticipantsUpdate(jid, [sender], "remove");
          delete warnings[sender];
        }
      }
    } catch (err) {
      console.log("خطأ:", err.message);
    }
  });
}
startBot();
