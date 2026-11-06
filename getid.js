const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const pino = require("pino");
async function run() {
  const { state, saveCreds } = await useMultiFileAuthState("whatsapp_session");
  const sock = makeWASocket({ logger: pino({ level: "silent" }), auth: state });
  sock.ev.on("connection.update", async (update) => {
    if (update.connection === "open") {
      try {
        const res = await sock.groupGetInfoFromInvite("CFkr2ow7mTc4TGXxge1Bwb");
        console.log("\n📌 معرف المجموعة هو: " + res.id + "\n");
        process.exit(0);
      } catch (e) {
        console.log("خطأ في الجلب، تأكد أن رقم البوت داخل المجموعة.");
        process.exit(1);
      }
    }
  });
  sock.ev.on("creds.update", saveCreds);
}
run();