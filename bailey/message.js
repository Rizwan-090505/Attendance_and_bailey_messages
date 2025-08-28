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

// === Deduplicate UNSENT messages in DB (delete mode) ===
async function deduplicateTable() {
  console.log("🗑️ Deduplicating UNSENT messages in table...");

  const { data, error } = await supabase
    .from("messages")
    .select("id, number, text, sent, created_at")
    .eq("sent", false) // ❗ only unsent
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
      if (shouldReconnect) connectBot(messages);
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

      console.log("🏁 Step 9: All messages attempted.");
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

  let startDate, endDate;

  if ((!startDateInput || startDateInput === "0") && (!endDateInput || endDateInput === "0")) {
    const today = new Date().toISOString().split("T")[0];
    startDate = `${today}T00:00:00Z`;
    endDate = `${today}T23:59:59Z`;
    console.log(`📅 No dates given, using TODAY: ${today}`);
  } else {
    startDate = `${startDateInput}T00:00:00Z`;
    endDate = `${endDateInput}T23:59:59Z`;
  }

  console.log(`📅 Using timestamp range: ${startDate} → ${endDate}`);

  // Step 2: Filter deduped set by date range and format numbers
  const messages = uniqueUnsent
    .filter((m) => m.created_at >= startDate && m.created_at <= endDate)
    .map((m) => {
      const raw = m.number.toString().replace(/[^0-9]/g, "");
      let jid = "";
      if (raw.startsWith("92") && raw.length >= 11) {
        jid = `${raw}@s.whatsapp.net`;
      } else if (raw.startsWith("3") && raw.length === 10) {
        jid = `92${raw}@s.whatsapp.net`;
      }
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
