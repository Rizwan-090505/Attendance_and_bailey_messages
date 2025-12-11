// === IMPORTS ===
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

// === SUPABASE CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === HELPERS ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (q) =>
  new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

// Normalize Pakistan number to WhatsApp JID
function toJid(mobile) {
  if (!mobile) return null;
  const d = mobile.toString().replace(/\D/g, "");
  let e164 = null;

  if (d.startsWith("92") && d.length >= 12) e164 = d;
  else if (d.startsWith("0") && d.length === 11) e164 = "92" + d.slice(1);
  else if (d.startsWith("3") && d.length === 10) e164 = "92" + d;
  else if (d.startsWith("0092") && d.length >= 14) e164 = d.slice(2);

  return e164 ? `${e164}@s.whatsapp.net` : null;
}

// Fetch students from Supabase
async function getStudentsByClasses(classIds) {
  const { data, error } = await supabase
    .from("students")
    .select("studentid, name, fathername, mobilenumber, class_id")
    .in("class_id", classIds);

  if (error) {
    console.error("❌ Error fetching students:", error.message);
    process.exit(1);
  }

  const contacts = [];
  const seen = new Set();

  for (const s of data || []) {
    const jid = toJid(s.mobilenumber);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);

    contacts.push({
      studentid: s.studentid,
      name: s.name,
      fathername: s.fathername,
      class_id: s.class_id,
      jid
    });
  }

  console.log(
    `✅ Found ${contacts.length} valid recipients across classes [${classIds.join(
      ", "
    )}]`
  );

  return contacts;
}

// Prepare WA media payload
function buildMediaPayload(buffer, mimetype, fileName, caption) {
  if (mimetype.startsWith("image/")) return { image: buffer, caption };
  if (mimetype.startsWith("video/")) return { video: buffer, caption };
  if (mimetype.startsWith("audio/")) return { audio: buffer, mimetype };
  return { document: buffer, mimetype, fileName, caption };
}

// === ROBUST CONNECTION HANDLER ===
async function startWhatsApp(recipients, textMessage, media) {
  async function connect() {
    console.log(`🔄 Connecting to WhatsApp...`);

    const { state, saveCreds } = await useMultiFileAuthState("auth_info");

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),

      browser: Browsers.macOS("Safari"),
      version,

      mobile: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      fireInitQueries: false,
      generateHighQualityLinkPreview: false,
      emitOwnEvents: false,

      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 20000,

      shouldIgnoreJid: (jid) => jid.endsWith("@broadcast"),

      getMessage: async () => undefined
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\n📸  Scan the QR code below:\n");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("\n✅ WhatsApp connected!");
        await delay(2000);
        await sendMessages(sock, recipients, textMessage, media);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`⚠️ Connection closed (Status: ${statusCode || "unknown"})`);

        if (shouldReconnect) {
          console.log("⏳ Reconnecting...");
          await delay(5000);
          connect();
        } else {
          console.log("❗ Logged out. Delete auth_info folder and restart.");
          process.exit(1);
        }
      }
    });

    return sock;
  }

  return connect();
}

// SEND MESSAGES
async function sendMessages(sock, recipients, textMessage, media) {
  let sent = 0;
  console.log("🚀 Starting bulk send...");

  for (const r of recipients) {
    try {
      if (media) {
        const payload = buildMediaPayload(
          media.buffer,
          media.mimetype,
          media.fileName,
          textMessage
        );
        await sock.sendMessage(r.jid, payload);
      } else {
        await sock.sendMessage(r.jid, { text: textMessage });
      }

      console.log(`✔️  [${sent + 1}/${recipients.length}] Sent to ${r.name}`);
    } catch (err) {
      console.error(`❌ Failed to send ${r.jid}:`, err.message);
    }

    sent++;
    const isLast = sent === recipients.length;

    if (!isLast) {
      if (sent % 50 === 0) {
        console.log("⏸  Taking a 30s break...");
        await delay(30000);
      } else {
        await delay(Math.floor(Math.random() * 1500) + 1000);
      }
    }
  }

  console.log("\n🏁 Finished sending. Exiting...");
  setTimeout(() => process.exit(0), 2000);
}

// === MAIN ORCHESTRATOR ===
(async function main() {
  const classInput = await ask("Enter class_id(s) (comma/space separated): ");
  const classIds = classInput
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (isNaN(Number(x)) ? x : Number(x)));

  if (classIds.length === 0) {
    console.log("⚠️ No class IDs. Exiting.");
    rl.close();
    return;
  }

  let media = null;

  const attach = (await ask("Attach a file? (y/n): ")).toLowerCase();
  if (attach === "y") {
    const fp = await ask("Enter full file path: ");
    if (fs.existsSync(fp)) {
      media = {
        buffer: fs.readFileSync(fp),
        mimetype: mime.lookup(fp) || "application/octet-stream",
        fileName: path.basename(fp)
      };
      console.log(`📎 Attached: ${media.fileName}`);
    } else {
      console.log("⚠️ File not found. Sending without attachment.");
    }
  }

  let textMessage = await ask("Enter message text (blank = '.'): ");
  if (!textMessage) textMessage = ".";

  const recipients = await getStudentsByClasses(classIds);
  if (!recipients.length) {
    console.log("⚠️ No valid WhatsApp numbers. Exiting.");
    rl.close();
    return;
  }

  await startWhatsApp(recipients, textMessage, media);
})();

