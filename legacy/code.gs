/**
 * CONFIGURATION
 * 1. Insert your Telegram Bot Token and Admin Chat ID below.
 * 2. Deploy as a Web App first, then paste the Web App URL here.
 * 3. Run the setWebhook() function to connect your Bot to this script.
 */
const TELEGRAM_BOT_TOKEN = ''; 
const ADMIN_CHAT_ID = ''; // e.g., -100123456789
const WEBAPP_URL = ''; // Paste AFTER your first deployment
const SHEET_NAME = 'KIT_Admissions_Leads';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('KIT Admissions')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function doPost(e) {
  // 1. Immediately acknowledge empty requests
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput('OK');
  }

  try {
    const contents = JSON.parse(e.postData.contents);
    const updateId = contents.update_id ? contents.update_id.toString() : null;
    
    // 2. ANTI-LOOP CACHE: Check if we've seen this exact message before
    if (updateId) {
      const cache = CacheService.getScriptCache();
      if (cache.get(updateId)) {
        return ContentService.createTextOutput('OK'); // We already answered this, ignore it completely
      }
      cache.put(updateId, 'processed', 21600); // Lock this message ID for 6 hours
    }
    
    // 3. Process the /start command
    if (contents.message && contents.message.text && contents.message.text.startsWith('/start')) {
      const chatId = contents.message.chat.id;
      const text = "🎓 *Welcome to KIT Admissions!*\n\nClick the button below to calculate your first-year tuition and apply.";
      
      const keyboard = {
        inline_keyboard: [[{ text: "Open Admissions App", web_app: { url: WEBAPP_URL } }]]
      };
      
      // Force the message to send
      sendTelegramMessage(chatId, text, keyboard);
    }
  } catch(err) {
    // Fail silently so we still return 'OK' below
  }
  
  // 4. Always tell Telegram the request was received perfectly
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

function calculateFees(department, grade) {
  const baseTuition = department === 'Engineering' ? 5000 : 4000;

  const discounts = {
    Standard: { 'A': 50, 'B': 30, 'C': 10, 'D': 0, 'E': 0, 'F': 0 },
    Partner:  { 'A': 55, 'B': 40, 'C': 20, 'D': 10, 'E': 0, 'F': 0 }
  };

  const stdDiscPct = discounts.Standard[grade] || 0;
  const partDiscPct = discounts.Partner[grade] || 0;

  const stdYear1 = baseTuition * (1 - (stdDiscPct / 100));
  const partYear1 = baseTuition * (1 - (partDiscPct / 100));

  return {
    base: baseTuition,
    grade: grade,
    standard: {
      discountPct: stdDiscPct,
      quarter: Math.round(stdYear1 / 4),
      semester: Math.round(stdYear1 / 2),
      yearly: Math.round(stdYear1)
    },
    partner: {
      discountPct: partDiscPct,
      quarter: Math.round(partYear1 / 4),
      semester: Math.round(partYear1 / 2),
      yearly: Math.round(partYear1)
    }
  };
}

function processSubmission(data) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow([
      "Timestamp", "Name", "Gender", "Phone", "Parent Phone", "Email", 
      "Province", "High School", "Department", "Major", "Grade", "Questions"
    ]);
    sheet.getRange("1:1").setFontWeight("bold");
  }

  const fees = calculateFees(data.department, data.grade);

  sheet.appendRow([
    new Date(), data.name, data.gender, data.phone, data.parentPhone, data.email, 
    data.province, data.highschool, data.department, data.major, data.grade, data.inquiry
  ]);

  const adminMsg = `🚨 *New KIT Admission Lead*\n\n` +
              `👤 *Name:* ${data.name} (${data.gender})\n` +
              `📞 *Phone:* ${data.phone}\n` +
              `👪 *Parent Phone:* ${data.parentPhone || 'N/A'}\n` +
              `🏫 *School:* ${data.highschool} (${data.province})\n` +
              `🏛 *Dept:* ${data.department}\n` +
              `🎓 *Major:* ${data.major}\n` +
              `📝 *Grade:* ${data.grade}\n` +
              `💬 *Inquiry:* ${data.inquiry || 'None'}`;
              
  sendTelegramMessage(ADMIN_CHAT_ID, adminMsg);

  if (data.chatId && data.chatId !== 'Unknown') {
    const studentMsg = `🎓 *Dear ${data.name},*\n\n` +
      `Here is your First-Year Tuition estimate for *${data.major}*:\n\n` +
      `*Grade ${data.grade} Non-partner School*\n` +
      `${fees.base}$/year, discount ${fees.standard.discountPct}%, pay quarter ${fees.standard.quarter}$, pay semester ${fees.standard.semester}$, pay yearly ${fees.standard.yearly}$\n\n` +
      `*Grade ${data.grade} KIT-Partner*\n` +
      `${fees.base}$/year, discount ${fees.partner.discountPct}%, pay quarter ${fees.partner.quarter}$, pay semester ${fees.partner.semester}$, pay yearly ${fees.partner.yearly}$\n\n` +
      `_Note: Above price exclude admission fee $500 one time fee._`;

    sendTelegramMessage(data.chatId, studentMsg);
  }

  return JSON.stringify(fees);
}

function sendTelegramMessage(chatId, text, replyMarkup = null) {
  let payload = { chat_id: chatId, text: text, parse_mode: "Markdown" };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, options);
}

function forceClearAndResetWebhook() {
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`);
  const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WEBAPP_URL}`);
  Logger.log(response.getContentText());
}