// === IMPORTS ===
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import nodeHtmlToImage from "node-html-to-image";
import qrcode from "qrcode";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

// === SUPABASE CONFIG ===

const supabaseUrl="https://pculxvgaeehscandwmic.supabase.co"
const supabaseAnonKey="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjdWx4dmdhZWVoc2NhbmR3bWljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1Njc2NjQsImV4cCI6MjA3NTE0MzY2NH0.5ch1gJH5RiIH3Spp_Ne-eg6D1oqSFEYtJPsAO7CqlJk"
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// === READ LOGO FOR EMBEDDING ===
// Reads the logo.jpg file and converts it to a Base64 data URI for embedding in the HTML.
// This prevents issues with file paths when generating the image.
const logoPath = 'logo.jpg';
let logoBase64 = '';
try {
  if (fs.existsSync(logoPath)) {
    const logoBuffer = fs.readFileSync(logoPath);
    logoBase64 = `data:image/jpeg;base64,${logoBuffer.toString('base64')}`;
  } else {
    console.warn('⚠️ Logo file "logo.jpg" not found. The text logo will be used as a fallback.');
  }
} catch (err) {
  console.error('❌ Error reading logo file:', err);
}

// === STYLED TEMPLATE (HIGH-FIDELITY CLONE) ===
function generateStyledTemplate(record) {
  // Use today's date for 'Issue Date' and 'Call to Action Date'
  const issueDate = new Date().toLocaleDateString("en-GB");
  // Calculate the 'Call to Action' date (today + 3 days)
  const ctaDate = new Date();
  ctaDate.setDate(ctaDate.getDate() + 3);
  const formattedCtaDate = ctaDate.toLocaleDateString("en-GB");

  // The actual text from the original notice, with dynamic fields
  const urduBodyText = `
    آپ کو بذریعہ نوٹس مطلع کیا جاتا ہے کہ پاکستان ٹیلی کمیونیکیشن کمپنی لمیٹڈ کے ریکارڈ کے مطابق آپ کے مذکورہ ٹیلی فون کے واجبات مبلغ
    <span class="amount-due">Rs. ${record.def_amount}</span>
    ادا نہیں ہوئے اور آپ کا ٹیلی فون عدم ادائیگی کی وجہ سے مستقل بند ہو چکا ہے۔`;
  
  const urduPoint1 = `   آ پ سے درخواست ہے کہ براہ کرم اپنے واجبات
    <span style="font-weight: bold; color: #0000FF;">${formattedCtaDate}</span>
    تک جمع کروائیں، واجبات کی عدم ادائیگی کی صورت میں، کمپنی ٹیلی فون اور اس سے منسلک خدمات منقطع کرنے کا حق محفوظ رکھتی ہے۔`;
    
  // Note that some fields like 'default_tel_no' and 'nic' are not used in the template below for brevity and to stick to the original image's displayed fields, but they are available in the 'record' object.

  return `
    <!DOCTYPE html>
    <html lang="ur" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Defaulter Notice</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" rel="stylesheet">
        <style>
            /* Base styles for the document */
            body {
                font-family: 'Noto Nastaliq Urdu', Arial, sans-serif;
                margin: 0;
                padding: 20px;
                background-color: #f8f8f8;
                direction: rtl; /* Set base direction to Right-to-Left */
                line-height: 1.8;
                text-align: right;
            }

            .document-container {
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #fff;
                border: 1px solid #ccc;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
            }

            /* Header Section */
            .header {
                display: flex;
                justify-content: space-around;
                align-items: flex-start;
                margin-bottom: 20px;
                border-bottom: 1px solid #eee;
                padding-bottom: 10px;
                text-align:right;
            }

            .logo-text {
                /* This is the logo side */
                display: flex;
                flex-direction: column;
                align-items: flex-start; /* Aligns content to the left side of its container */
                text-align: left;
                direction: ltr; /* Temporarily switch to LTR for logo elements and English text */
            }

            .logo-text img {
                height: 80px; /* Adjusted height for a typical logo */
                margin-bottom: 5px;
            }

            .ptcl-header {
                display: flex;
                flex-direction: column;
                align-items: center;
                jusitfy-items:center;
                text-align: right;
                direction: rtl; /* Explicitly set to RTL */
            }

            .ptcl-header h1 {
                font-size: 20px;
                margin: 0;
                font-weight: bold;
            }

            .ptcl-header p {
                font-size: 14px;
                margin: 5px 0 0 0;
                line-height: 1.5;
            }
            
            /* User/Account Details Table */
            .details-section {
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                margin-bottom: 25px;
                font-size: 14px;
            }

            .user-details, .account-details {
                width: 48%; /* Adjust for spacing */
                direction: ltr; /* English content, set to LTR */
                

            }
            
            .user-details {
                border: 1px solid #ddd;
                padding: 10px;
                display:flex;
                flex-direction:column;
                align-items:flex-start;
            }

            .account-details {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 5px 10px;
                padding: 10px 0;
            }

            .account-details strong {
                text-align: right; /* Aligns the labels to the left */
                font-weight: normal;
            }

            .account-details .value {
                text-align: left; /* Aligns the values to the right */
                font-weight: bold;
            }
            
            .details-label {
                font-weight: normal;
            }
            
            .details-value {
                font-weight: bold;
            }
            
            /* Notice Title */
            .notice-title-container {
                display: flex;
                flex-direction:row-reverse;
                justify-content: center;
                margin: 30px 0 10px 0;
                position: relative;
            }

            .defaulter-notice {
                background-color: #ffd000ff; /* Yellow box color */
                padding: 5px 30px;
                font-size: 28px;
                font-weight: 900;
                color: #000;
                text-align: center;
                display: inline-block;
            }

            .akhir-moqa {
                position: absolute;
                top: -20px;
                left: 0;
                font-size: 18px;
                text-align: right;
                direction: rtl;
                color:red;
            }
            
            .akhir-moqa p {
                margin: 0;
                font-weight: bold;
                outline: 2px solid red;
            }

            /* Main Notice Text */
            .notice-body {
                font-size: 16px;
                text-align: justify;
                margin-top: 20px;
            }

            .notice-body p {
                margin: 0 0 10px 0;
            }

            .amount-due {
                font-weight: bold;
                color: #d9534f;
                display: inline-block;
                margin-left: 5px;
            }

            .lihaza {
                text-align: center;
                font-size: 24px;
                color: #d9534f;
                font-weight: bold;
                margin: 20px 0 15px 0;
            }

            /* Action Points List */
            .action-points {
                list-style: none;
                padding: 0;
                margin: 10px 0;
                font-size: 16px;
            }

            .action-points li {
                display: flex;
                align-items: flex-start;
                margin-bottom: 8px;
            }

            .action-points .number {
                font-weight: bold;
                margin-left: 10px;
                font-size: 18px;
                color: #000;
            }
            
            .action-points .text-content {
                flex-grow: 1;
            }

            .large-red-text {
                color: #d9534f;
                font-size: 18px;
                font-weight: bold;
                margin-top: 15px;
                line-height: 1.5;
            }

            /* Note Box */
            .note-container {
                position: relative;
                border: 2px solid #000;
                padding: 15px;
                margin-top: 20px;
                border-radius: 10px;
            }

            .note-header {
                position: absolute;
                top: -15px;
                right: 15px;
                background-color: #fff;
                padding: 0 10px;
                font-weight: bold;
                font-size: 18px;
                color: #000;
            }

            .note-list {
                list-style: none;
                padding: 0;
                margin: 0;
            }

            .note-list li {
                margin-bottom: 8px;
            }
            
            /* Footer/Contact Info */
            .contact-section {
                margin-top: 40px;
                border-top: 1px solid #eee;
                padding-top: 15px;
            }

            .contact-title {
                text-align: center;
                font-size: 18px;
                font-weight: bold;
                background-color: #f0f0f0;
                padding: 5px 10px;
                display: inline-block;
                margin: 0 auto 10px auto;
                width: 100%;
            }

            .signature-details {
                display: flex;
                justify-content: space-between;
                margin-top: 20px;
                direction: ltr; /* English contact details, LTR */
            }
            
            .signature-details .english-detail {
                text-align: left;
                direction: ltr;
            }
            
            .signature-details .urdu-detail {
                text-align: right;
                direction: rtl;
            }
            
            .urdu-contact-text {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
            }
            
            .urdu-contact-text p {
                margin: 0;
            }
            
            /* Specific adjustments for original image appearance */
            .urdu-line-1 {
                font-size: 16px;
                margin: 0;
            }
            .urdu-line-2 {
                font-size: 12px;
                margin: 0;
            }
            .eng-field-title {
                font-weight: normal;
            }
            .eng-field-value {
                font-weight: bold;
                direction:ltr;
            }
            .red {
            color:red;
            }
            
        </style>
    </head>
    <body>
        <div class="document-container">

            <div class="header">
                <div class="logo-text">
                    ${logoBase64 
                        ? `<img src="${logoBase64}" alt="PTCL Logo">` 
                        : `<span style="font-size: 30px; color: #00A651; font-weight: bold;">&#x25CF; PTCL</span>
                        <span style="font-size: 10px; color: #00A651; border: 1px solid #00A651; padding: 2px 5px; border-radius: 10px; margin-top: 5px;">hello to the future</span>
                        `
                    }
                </div>
                
                <div class="ptcl-header">
                    <h1>پاکستان ٹیلی کمیونیکیشن کمپنی لمیٹڈ</h1>
                    <p>کریڈٹ مینیجمنٹ سینٹر، 2 اے گولف روڈ، جی او آر 1، لاہور</p>
                </div>
            </div>

            <div class="details-section">
                
                <div class="account-details">
                    <strong class="eng-field-title">Account ID:</strong> <span class="eng-field-value" style="color: #0000FF;">${record.ac_id}</span>
                    <strong class="eng-field-title">Issue Date:</strong> <span class="eng-field-value">${issueDate}</span>
                    <strong class="eng-field-title">Def Tele No:</strong> <span class="eng-field-value">${record.default_tel_no}</span>
                    <strong class="eng-field-title">Disconnection Date:</strong> <span class="eng-field-value">${record.disconnection_date}</span>
                </div>
                
                <div class="user-details">
                    <p><span class="eng-field-value">${record.name}</span></p>
                    <p><span class="eng-field-value">${record.address.split('\n')[0] || ''}</span></p>
                    <p><span class="eng-field-value">${record.address.split('\n')[1] || ''}</span></p>
                    <p><span class="eng-field-value">${record.address.split('\n')[2] || ''}</span></p>
                    <p><span class="eng-field-title">PH #</span> <span class="eng-field-value">${record.contact}</span></p>
                    <p><span class="eng-field-title">CNIC:</span> <span class="eng-field-value">${record.nic}</span></p>
                </div>
            </div>
            
            <div class="notice-title-container">
                <div class="defaulter-notice">
                    ڈیفالٹر نوٹس
                </div>
                <div class="akhir-moqa">
                    <p>آخری موقع</p>
                    <p style="font-size: 14px; font-weight: normal;">نوٹس برائے ادائیگی</p>
                </div>
            </div>
            
            <hr style="border: none; border-top: 1px solid #ccc; margin-top: 0;">

            <div class="notice-body">
                <p>
                    ${urduBodyText}
                </p>
            </div>

            <div class="lihaza">
                لہٰذا
            </div>
            
            <ul class="action-points">
                <li>
                    <span class="number">1-</span>
                    <span class="text-content">${urduPoint1}</span>
                </li>
                <li class="large-red-text">
                    <span class="number" style="color: #d9534f;">2-</span>
                    <span class="text-content">اگر آپ نے بقایا جات کی ادائیگی کر دی ہو تو فوراً دفترِ ہذا کو اطلاع دیں۔</span>
                </li>
                <li>
                    <span class="number">3-</span>
                    <span class="text-content">مزید یہ کہ کمپنی قابلِ اطلاق قواعد و ضوابط کے مطابق کارروائی کر سکتی ہے۔</span>
                </li>
            </ul>
            
            <div class="note-container">
                <span class="note-header">نوٹ</span>
                <ul class="note-list">
                    <li><span style="font-weight: bold; color: #d9534f;">1-یہ نوٹس درج ذیل برانچوں میں ادا کریں</span> <span class="text-content">
                        <span style="direction: ltr; text-align: left; display: inline-block;">Joint Shop Ufone/PTCL, PCPM Machines, UPTCL App/Mobile App, Online PTCL Bill/Web payment through Debit & Credit card, U-Bank/U-Paisa, Jazzcash, Easypaisa,</span>
                    </span></li>
                    <li><span style="font-weight: bold;">2-</span> <span class="text-content">یہ بل  ان برانچوں میں دی گئی اکاؤنٹ آئی ڈی 
                    <span style="font-weight: bold; color: #0000FF;">${record.ac_id}</span>
                    کے ساتھ ادا کیا جا سکتا ہے۔</span></li>
                    <li><span style="font-weight: bold;">3-</span> <span class="text-content">بل کی ادائیگی کے بعد ماڈیم (ADSL,VDSL,IPTV,GPON) دفترِ ہذا میں جمع کروائیں۔</span></li>
                    <li><span style="font-weight: bold;">4-</span> <span class="text-content">بل کی ادائیگی کے بعد نمبر کی بحالی کے لئے ${record.inspector} واٹس ایپ پر رابطہ کریں۔</span></li>
                    
                </ul>
            </div>
            
            <div class="contact-section">
                <div class="contact-title red">
                    مزید معلومات کے لیے رابطہ کریں
                </div>
                
                <div class="signature-details">
                    
                    
                    <div class="urdu-detail">
                        <div class="urdu-contact-text">
                            <p style="font-weight: bold;">${record.inspector}</p>
                            <p>ريكوری انسپکٹر پی ٹی سی ایل</p>
                            <p>کریڈٹ مینجمنٹ سینٹر 2-A، گالف روڈ، GOR-1، لاہور۔</p>
                        </div>
                    </div>
                </div>

            </div>

        </div>
    </body>
    </html>`;
}

// === CONVERT HTML TO IMAGE ===
async function createImage(record) {
  // Use the new styled template
  const html = generateStyledTemplate(record); 
  // Add a necessary font-url for node-html-to-image to correctly load the Noto Nastaliq Urdu font
  return await nodeHtmlToImage({ 
    html,
    puppeteerArgs: { 
      args: ['--no-sandbox']
    }
  });
}

// === FETCH DATA FOR UNSENT MESSAGES ===
// **EDITED**: Fetches all defaulters that do NOT have a 'sent_status: true' in the 'messages' table.
// It joins 'messages' with 'defaulters' using the FK 'defaulter_sr_no' and selects the full defaulter record.
async function getDefaultersForSending() {
  // First, find records in 'messages' that are NOT marked as sent.
  // Note: Assuming 'defaulters' table uses 'sr_no' as its primary key.
  const { data, error } = await supabase
    .from("messages")
    .select("*, defaulters ( * )") // Select all columns from messages AND all columns from the related defaulters record
    .eq("sent_status", false)
    .eq("message_type", "defaulter"); // Added a filter for 'defaulter' type messages, if applicable

  if (error) {
    console.error("❌ Error fetching unsent messages:", error);
    return [];
  }

  // The result will be an array of message objects, each containing a 'defaulters' object.
  // We need to extract the actual defaulter record for processing.
  const defaulterRecords = data
    .map(message => message.defaulters)
    .filter(record => record !== null); // Filter out any messages without a corresponding defaulter record

  console.log(`📋 Retrieved ${defaulterRecords.length} unsent defaulter records.`);
  return defaulterRecords;
}

// === MARK MESSAGE AS SENT (Update existing message record) ===
async function markMessageAsSent(defaulter_sr_no) {
    // Find the message record using the FK and update its status.
    // Assuming the 'messages' table has a 'defaulter_sr_no' column and a 'sent_status' column.
  const { error } = await supabase
    .from("messages")
    .update({ sent_status: true })
    .eq("defaulter_sr_no", defaulter_sr_no)
    .eq("message_type", "defaulter"); // Ensure we only update defaulter type messages

  if (error) console.error(`❌ Failed to update message status for SR#${defaulter_sr_no}:`, error);
  else console.log(`✅ Message status updated to SENT for SR#${defaulter_sr_no}`);
}

// === MAIN WHATSAPP CONNECTION ===
async function connectToWhatsApp() {
  console.log("🚀 Starting WhatsApp connection...");
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.toFile("qr.png", qr, (err) => {
        if (err) console.error("❌ QR error:", err);
        else console.log("📸 QR saved as qr.png — scan to connect.");
      });
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect.error instanceof Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) connectToWhatsApp();
      else console.log("❌ Logged out. Delete 'auth_info_baileys' to reauthenticate.");
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected!");
      if (fs.existsSync("qr.png")) fs.unlinkSync("qr.png");

      // **EDITED**: Get defaulters based on the unsent status in the 'messages' table.
      const defaulters = await getDefaultersForSending(); 
      for (const record of defaulters) {
        
        // --- MODIFICATION START ---
        // Validate the contact number from the record.
        // It must exist and be a string of digits (e.g., '923...').
        if (!record.contact || typeof record.contact !== 'string' || !/^\d+$/.test(record.contact.trim())) {
            console.warn(`⚠️ Skipping record for ${record.name} (SR#${record.sr_no}) due to invalid or missing contact number: "${record.contact}"`);
            // Optionally, you might want to log this failure in the messages table, but for now, we just skip.
            continue; // Skip to the next record in the loop.
        }

        // Format the contact number into a valid WhatsApp JID.
        const recipientJid = `${record.contact.trim()}@s.whatsapp.net`;
        // --- MODIFICATION END ---
        
        try {
            // Generate the personalized image for the current record.
            const img = await createImage(record); 

            // Send the message to the dynamically determined recipient.
            await sock.sendMessage(recipientJid, {
              image: img,
              caption: `Defaulter Notice — ${record.name}`,
            });

            console.log(`📤 Sent notice to ${record.name} at ${recipientJid}`);
            
            // **EDITED**: Update the existing message record's sent_status to true.
            await markMessageAsSent(record.sr_no); 

        } catch (error) {
            console.error(`❌ Failed to send notice to ${record.name} (${recipientJid}). Error:`, error);
            // Consider adding a log for failed send attempts as well.
        }
      }

      console.log("🎉 All notices processed successfully!");
    }
  });
}

// === START ===
connectToWhatsApp();