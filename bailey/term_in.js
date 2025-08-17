const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const readline = require("readline");

// Helper: prompt user for input
function askUser(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Helper: format numbers into WhatsApp JIDs
function formatNumbers(input) {
  return input.split(",").map((num) => {
    const raw = num.trim().replace(/[^0-9]/g, "");
    if (raw.startsWith("92") && raw.length >= 11) {
      return `${raw}@s.whatsapp.net`;
    } else if (raw.startsWith("3") && raw.length === 10) {
      return `92${raw}@s.whatsapp.net`;
    } else {
      return null;
    }
  }).filter(Boolean);
}

async function connectBot() {
  const messageInput = await askUser("📨 Enter your message (use \\n for new lines):\n> ");
  const rawNumbers = await askUser("📞 Enter comma-separated numbers (e.g. 92300..., 301..., ...):\n> ");

  const formattedMessage = messageInput.replace(/\\n/g, "\n");
  const contacts = formatNumbers(rawNumbers);

  if (contacts.length === 0) {
    console.log("⚠️ No valid numbers provided. Exiting.");
    return;
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({ version, auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Connection closed:", lastDisconnect?.error);
      if (shouldReconnect) {
        connectBot();
      }
    } else if (connection === "open") {
      console.log("✅ Connected to WhatsApp");
      for (let jid of contacts) {
        try {
          await sock.sendMessage(jid, { text: formattedMessage });
          console.log("📤 Sent to:", jid);
        } catch (err) {
          console.error("⚠️ Failed to send to:", jid, err.message);
        }
      }

      console.log("✅ All messages attempted.");
    }
  });
}

connectBot();
