// === IMPORTS ===
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const { createClient } = require("@supabase/supabase-js");
const readline = require("readline");

// === CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === Prompt helper ===
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

// === Delay helper ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// --- Helper to parse YYYY-MM-DD safely ---
function parseDate(input, isEnd = false) {
  if (!input || input.trim() === "" || input === "0") {
    const now = new Date();
    return isEnd
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  }

  const [y, m, d] = input.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error(`❌ Invalid date format: ${input}`);
  }

  return isEnd
    ? new Date(y, m - 1, d, 23, 59, 59)  // local end of day
    : new Date(y, m - 1, d, 0, 0, 0);    // local start of day
}


// === Deduplicate UNSENT messages in DB (delete mode) ===
async function deduplicateTable() {
  console.log("🗑️ Deduplicating UNSENT messages in table...");

  const { data, error } = await supabase
    .from("messages")
    .select("id, number, text, sent, created_at")
    .eq("sent", false) // only unsent
    .order("created_at", { ascending: true });

  if (error) {
    console.error("❌ Error fetching messages:", error.message);
    return [];
  }

  const seen = new Set();
  const duplicates = [];

  for (const row of data) {
    const key = `${row.number}|${row.text}`; // duplicate key = number+text
    if (seen.has(key)) {
      duplicates.push(row.id);
    } else {
      seen.add(key);
    }
  }

  console.log(`ℹ️ Found ${duplicates.length} duplicate UNSENT messages.`);

  if (duplicates.length > 0) {
    const { error: delError } = await supabase
      .from("messages")
      .delete()
      .in("id", duplicates);

    if (delError) {
      console.error("⚠️ Failed to delete duplicates:", delError.message);
    } else {
      console.log(`✔️ Deleted ${duplicates.length} duplicates permanently`);
    }
  } else {
    console.log("✅ No duplicates found among UNSENT messages.");
  }

  // return deduped UNSENT messages
  const { data: cleanData, error: fetchError } = await supabase
    .from("messages")
    .select("id, number, text, created_at")
    .eq("sent", false)
    .order("created_at", { ascending: true });

  if (fetchError) {
    console.error("❌ Error refetching unique UNSENT messages:", fetchError.message);
    return [];
  }

  return cleanData;
}

// === Mark message as sent in DB ===
async function markAsSent(id) {
  const { error } = await supabase
    .from("messages")
    .update({ sent: true })
    .eq("id", id);

  if (error) {
    console.error(`⚠️ Failed to mark message ${id} as sent:`, error.message);
  } else {
    console.log(`✔️ Marked message ${id} as sent`);
  }
}

// === Phone number → WhatsApp JID ===
function formatNumberToJid(number) {
  let raw = number.toString().replace(/[^0-9]/g, "");

  // handle local 03XXXXXXXXX format
  if (raw.startsWith("0") && raw.length === 11) {
    raw = "92" + raw.slice(1);
  }
  // already in 92XXXXXXXXXX
  if (raw.startsWith("92") && raw.length === 12) {
    return `${raw}@s.whatsapp.net`;
  }
  return null; // invalid
}

// === Connect to WhatsApp and send ===
async function connectBot(messages) {
  console.log("🔄 Step 4: Initializing WhatsApp connection...");

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  console.log(`ℹ️ Using Baileys version: ${version.join(".")}`);

  const sock = makeWASocket({ version, auth: state });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📸 Step 5: Scan the QR code to login");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Connection closed:", lastDisconnect?.error);
      if (shouldReconnect) {
        console.log("🔄 Reconnecting...");
        await delay(5000);
        connectBot(messages);
      }
    } else if (connection === "open") {
      console.log("✅ Step 6: Connected to WhatsApp");

      let sentCount = 0;
      for (let { id, jid, text } of messages) {
        console.log(`📤 Step 7: Sending to ${jid}...`);
        try {
          await sock.sendMessage(jid, { text });
          console.log(`✔️ Sent to: ${jid}`);
        } catch (err) {
          console.error(`⚠️ Failed to send to ${jid}:`, err.message);
        }

        await markAsSent(id);

        sentCount++;
        if (sentCount % 80 === 0) {
          console.log("⏸ Step 8: Pausing 40s after 80 messages...");
          await delay(40000);
        } else {
          console.log("⏳ Waiting 5s before next...");
          await delay(5000);
        }
      }

      console.log("🏁 Step 9: All messages attempted.");// graceful close
      process.exit(0);
    }
  });
}

// === Main ===
(async () => {
  console.log("🚀 Starting message sender script...");

  // Step 1: Deduplicate UNSENT in DB + refetch unique unsent
  const uniqueUnsent = await deduplicateTable();

  const startDateInput = await askQuestion("Enter start date (YYYY-MM-DD or 0 for today): ");
  const endDateInput = await askQuestion("Enter end date (YYYY-MM-DD or 0 for today): ");

  const startDate = parseDate(startDateInput, false);
  const endDate = parseDate(endDateInput, true);

console.log(
  `📅 Using timestamp range: ${startDate.toLocaleString()} → ${endDate.toLocaleString()}`
);
  console.log(`📅 Using timestamp range: ${startDate.toISOString()} → ${endDate.toISOString()}`);

  // Step 2: Filter deduped set by date range and format numbers
  const messages = uniqueUnsent
    .filter((m) => {
      const t = new Date(m.created_at).getTime();
      return t >= startDate.getTime() && t <= endDate.getTime();
    })
    .map((m) => {
      const jid = formatNumberToJid(m.number);
      return { id: m.id, jid, text: m.text };
    })
    .filter((m) => m.jid);

  console.log(`✅ Final unique UNSENT messages in range: ${messages.length}`);

  if (messages.length === 0) {
    console.log("⚠️ No UNSENT messages found for this date range.");
    process.exit(0);
  }

  // Step 3: Connect and send
  connectBot(messages);
})();
