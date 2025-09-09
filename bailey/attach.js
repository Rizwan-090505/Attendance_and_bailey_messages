// === IMPORTS ===
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const readline = require("readline");

// === CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === HELPERS ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

// Normalize Pakistan number to WhatsApp JID
function toJid(mobile) {
  if (!mobile) return null;
  const d = mobile.toString().replace(/\D/g, "");
  let e164 = null;
  if (d.startsWith("92") && d.length >= 12) {
    e164 = d;
  } else if (d.startsWith("0") && d.length === 11) {
    e164 = "92" + d.slice(1);
  } else if (d.startsWith("3") && d.length === 10) {
    e164 = "92" + d;
  } else if (d.startsWith("0092") && d.length >= 14) {
    e164 = d.slice(2);
  }
  return e164 ? `${e164}@s.whatsapp.net` : null;
}

// Fetch students by multiple class IDs
async function getStudentsByClasses(classIds) {
  const { data, error } = await supabase
    .from("students")
    .select("studentid, name, fathername, mobilenumber, class_id")
    .in("class_id", classIds);

  if (error) {
    console.error("❌ Error fetching students:", error.message);
    process.exit(1);
  }

  const seen = new Set();
  const contacts = [];
  for (const s of data || []) {
    const jid = toJid(s.mobilenumber);
    if (!jid) continue;
    if (seen.has(jid)) continue;
    seen.add(jid);
    contacts.push({
      studentid: s.studentid,
      name: s.name,
      fathername: s.fathername,
      class_id: s.class_id,
      jid
    });
  }

  console.log(`✅ Found ${contacts.length} unique WhatsApp recipients across classes [${classIds.join(", ")}]`);
  return contacts;
}

// Decide WA message payload type
function buildMediaPayload(buffer, mimetype, fileName, caption) {
  if (!buffer) return null;
  if (mimetype.startsWith("image/")) {
    return { image: buffer, caption };
  }
  if (mimetype.startsWith("video/")) {
    return { video: buffer, caption };
  }
  if (mimetype.startsWith("audio/")) {
    return { audio: buffer, mimetype };
  }
  return { document: buffer, mimetype, fileName, caption };
}

// Wait until WhatsApp acknowledges a message
function waitForAck(sock, keyId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Ack timeout")), 30000);
    sock.ev.on("messages.update", function handler(updates) {
      for (const update of updates) {
        if (update.key?.id === keyId && update.status) {
          if (update.status >= 2) { // 2=server-ack, 3=delivered, 4=read
            clearTimeout(timeout);
            sock.ev.off("messages.update", handler);
            resolve();
          }
        }
      }
    });
  });
}

// === MAIN SEND FLOW ===
async function connectAndSend(recipients, textMessage, media) {
  console.log("🔄 Initializing WhatsApp connection (scan QR if shown)...");
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📸 Scan this QR to login:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Connection closed:", lastDisconnect?.error?.message || lastDisconnect?.error);
      if (shouldReconnect) connectAndSend(recipients, textMessage, media);
    } else if (connection === "open") {
      console.log("✅ WhatsApp connected. Sending messages...");

      let sent = 0;
      for (const r of recipients) {
        try {
          let msg;
          if (media) {
            const payload = buildMediaPayload(media.buffer, media.mimetype, media.fileName, textMessage);
            msg = await sock.sendMessage(r.jid, payload);
          } else {
            msg = await sock.sendMessage(r.jid, { text: textMessage });
          }

          // wait until WhatsApp server acknowledges
          await waitForAck(sock, msg.key.id);

          console.log(`✔️ Sent to ${r.name} (class ${r.class_id}) @ ${r.jid}`);
        } catch (err) {
          console.error(`⚠️ Failed to send to ${r.name} @ ${r.jid}:`, err);
        }

        sent++;
        if (sent % 80 === 0) {
          console.log("⏸ Cooling down 40s after 80 sends...");
          await delay(40000);
        } else {
          await delay(2000);
        }
      }

      console.log("🏁 Done. All messages attempted.");
      rl.close();
    }
  });
}

// === ORCHESTRATOR ===
(async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_PROJECT")) {
    console.error("❌ Configure SUPABASE_URL and SUPABASE_KEY.");
    process.exit(1);
  }

  const classInput = await ask("Enter class_id(s) (comma/space-separated): ");
  const classIds = classInput
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (isNaN(Number(x)) ? x : Number(x)));

  if (classIds.length === 0) {
    console.log("⚠️ No class IDs provided. Exiting.");
    rl.close();
    process.exit(0);
  }

  const attach = (await ask("Attach a file? (y/n): ")).toLowerCase();
  let media = null;
  if (attach === "y" || attach === "yes") {
    const fp = await ask("Enter full file path: ");
    if (fp && fs.existsSync(fp)) {
      const buffer = fs.readFileSync(fp);
      const mimetype = mime.lookup(fp) || "application/octet-stream";
      const fileName = path.basename(fp);
      media = { buffer, mimetype, fileName };
      console.log(`📎 Attached: ${fileName} (${mimetype})`);
    } else {
      console.log("⚠️ File not found. Continuing without attachment.");
    }
  }

  let textMessage = await ask("Enter message text (leave blank for default): ");
  if (!textMessage) textMessage = ".";

  const recipients = await getStudentsByClasses(classIds);
  if (recipients.length === 0) {
    console.log("⚠️ No valid WhatsApp numbers found. Exiting.");
    rl.close();
    process.exit(0);
  }

  await connectAndSend(recipients, textMessage, media);
})();
