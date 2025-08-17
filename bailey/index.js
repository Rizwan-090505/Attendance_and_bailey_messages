const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const xlsx = require("xlsx");

async function readContactsFromExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);

  const possibleFields = ["number", "Number", "contact", "Contact","Father Mobile"];
  const contacts = [];

  data.forEach((row) => {
    for (let field of possibleFields) {
      if (row[field]) {
        const raw = row[field].toString().replace(/[^0-9]/g, "");
        if (raw.startsWith("92") && raw.length >= 11) {
          contacts.push(`${raw}@s.whatsapp.net`);
        } else if (raw.startsWith("3") && raw.length === 10) {
          contacts.push(`92${raw}@s.whatsapp.net`);
        }
        break;
      }
    }
  });

  return contacts;
}

async function connectBot() {
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

      // 🔁 Send messages to contacts from Excel
      const contacts = await readContactsFromExcel("message_01_aug.xlsx");
      const msg = "Respected Parents \n Kindly be informed that submission of second part of SVT is due on Tuesday. Visit school on Monday or Tuesday during 8:30 AM - 11:30 AM to submit your child's SVT. Late submissions will not be accepted";

      for (let jid of contacts) {
        try {
          await sock.sendMessage(jid, { text: msg });
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
