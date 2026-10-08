/**
 * KIT Admissions Mini App - Backend API & Telegram Webhook
 * 
 * Implements the JSON API for the Mini App and the Telegram Bot webhook:
 * - doGet(e): Health check endpoint
 * - doPost(e): Request router for 'getConfig', 'submit', and Telegram webhook
 * - initData HMAC verification
 * - Fee calculations
 * - Concurrency control & deduplication
 * - Admin & student Telegram notifications
 */

// ============================================================================
// CONSTANTS & UTILITIES
// ============================================================================

const CONFIG_CACHE_KEY = 'kit_admissions_config_v1';
const CONFIG_CACHE_TTL_SEC = 300; // 5 minutes
const RATE_LIMIT_WINDOW_SEC = 600; // 10 minutes
const RATE_LIMIT_MAX_SUBMITS = 3;

/**
 * Standard JSON response constructor.
 *
 * @param {boolean} ok
 * @param {*} dataOrError
 * @param {boolean} [isError=false]
 * @return {ContentService.TextOutput}
 */
function createJsonResponse(dataOrError, isError) {
  const payload = isError
    ? { ok: false, error: dataOrError }
    : { ok: true, data: dataOrError };

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Retrieves a required secret from Script Properties.
 * Logs and throws an error if missing.
 *
 * @param {string} key
 * @return {string}
 */
function getRequiredSecret(key) {
  const val = PropertiesService.getScriptProperties().getProperty(key);
  if (!val) {
    const msg = `Missing required Script Property: "${key}"`;
    logEvent('ERROR', 'Config', msg);
    const err = new Error(msg);
    err.code = 'CONFIG_ERROR';
    throw err;
  }
  return val;
}

/**
 * Formats a monetary dollar amount without trailing .00 for whole numbers.
 * Examples: 1750 -> "$1,750", 437.5 -> "$437.50", 500 -> "$500".
 *
 * @param {number} amount
 * @return {string}
 */
function formatMoney(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return '$0';
  const isWhole = (amount % 1 === 0);
  const parts = isWhole ? amount.toFixed(0) : amount.toFixed(2);
  const [intPart, decPart] = parts.split('.');
  const formattedInt = Number(intPart).toLocaleString('en-US');
  return decPart ? `$${formattedInt}.${decPart}` : `$${formattedInt}`;
}

/**
 * Rounds a number to two decimal places.
 *
 * @param {number} num
 * @return {number}
 */
function roundToTwo(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

// ============================================================================
// REQUEST ROUTING
// ============================================================================

/**
 * GET request handler: Health check endpoint.
 *
 * @param {Object} e
 * @return {ContentService.TextOutput}
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'kit-admissions' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * POST request handler: Dispatches to action handlers or Telegram webhook.
 * Wrapped in a top-level try/catch so no unhandled exceptions escape.
 *
 * @param {Object} e
 * @return {ContentService.TextOutput}
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ code: 'BAD_REQUEST', message: 'Missing request body' }, true);
    }

    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return createJsonResponse({ code: 'BAD_REQUEST', message: 'Invalid JSON format' }, true);
    }

    // 1. Mini App Action requests
    if (body.action) {
      if (body.action === 'getConfig') {
        return handleGetConfig();
      }
      if (body.action === 'submit') {
        return handleSubmit(body);
      }
      return createJsonResponse({ code: 'BAD_REQUEST', message: `Unknown action: "${body.action}"` }, true);
    }

    // 2. Telegram Webhook updates
    if (body.update_id !== undefined && body.update_id !== null) {
      let webhookSecret;
      try {
        webhookSecret = getRequiredSecret('WEBHOOK_SECRET');
      } catch (err) {
        return createJsonResponse({ code: 'CONFIG_ERROR', message: 'Server configuration error' }, true);
      }

      const providedKey = e.parameter && e.parameter.key;
      if (!providedKey || providedKey !== webhookSecret) {
        logEvent('WARN', 'Webhook', 'Unauthorized webhook request attempt');
        return createJsonResponse({ code: 'UNAUTHORIZED', message: 'Unauthorized webhook key' }, true);
      }

      return handleTelegramWebhook(body);
    }

    return createJsonResponse({ code: 'BAD_REQUEST', message: 'Unsupported request format' }, true);
  } catch (err) {
    logEvent('ERROR', 'API', `Unexpected error in doPost: ${err.message}`, err);
    return createJsonResponse({ code: 'SERVER_ERROR', message: 'Unexpected server error' }, true);
  }
}

// ============================================================================
// CONFIG ACTION
// ============================================================================

/**
 * Returns configuration data for frontend form and fee previews.
 * Caches in CacheService for 5 minutes.
 *
 * @return {ContentService.TextOutput}
 */
function handleGetConfig() {
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(CONFIG_CACHE_KEY);
  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      return createJsonResponse(parsed, false);
    } catch (e) {
      // If cached data is corrupted, fall through to refresh
    }
  }

  let config;
  try {
    config = readConfig();
  } catch (err) {
    logEvent('ERROR', 'API', 'Failed to read configuration', err);
    return createJsonResponse({ code: 'CONFIG_ERROR', message: err.message }, true);
  }

  const grades = ['A', 'B', 'C', 'D', 'E'];
  const formattedRates = {
    partner: {},
    standard: {}
  };

  grades.forEach(g => {
    const basePartner = config.rates.partner[g];
    formattedRates.partner[g] = {
      baseRate: basePartner,
      extraOffer: config.extra_offer,
      finalRate: basePartner + config.extra_offer
    };

    const baseStandard = config.rates.standard[g];
    formattedRates.standard[g] = {
      baseRate: baseStandard,
      extraOffer: config.extra_offer,
      finalRate: baseStandard + config.extra_offer
    };
  });

  const responsePayload = {
    majors: config.majors,
    baseTuition: {
      Engineering: config.base_engineering,
      Management: config.base_management
    },
    extraOffer: config.extra_offer,
    admissionFee: config.admission_fee,
    callbackHours: config.callback_hours,
    rates: formattedRates,
    provinces: PROVINCES,
    phonePrefixes: PHONE_PREFIXES
  };

  try {
    cache.put(CONFIG_CACHE_KEY, JSON.stringify(responsePayload), CONFIG_CACHE_TTL_SEC);
  } catch (e) {
    Logger.log(`Failed to write config to cache: ${e.message}`);
  }

  return createJsonResponse(responsePayload, false);
}

// ============================================================================
// TELEGRAM INITDATA VERIFICATION
// ============================================================================

/**
 * Verifies Telegram WebApp initData string using HMAC-SHA256 according to Telegram documentation.
 * Checks HMAC signature and verifies auth_date is within 24 hours.
 * Uses shared computeTelegramInitDataHash with strict Byte[] method signatures.
 *
 * @param {string} initData Raw query string from Telegram.WebApp.initData
 * @param {string} botToken Telegram Bot Token
 * @return {{ valid: boolean, user?: { id: number, username: string }, authDate?: number, error?: string }}
 */
function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string') {
    return { valid: false, error: 'Missing initData' };
  }
  if (!botToken || typeof botToken !== 'string') {
    return { valid: false, error: 'Missing bot token' };
  }

  const pairs = initData.split('&');
  const params = {};
  let providedHash = '';

  try {
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!pair) continue;
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const key = pair.substring(0, eqIdx);
      const rawVal = pair.substring(eqIdx + 1);
      const val = decodeURIComponent(rawVal.replace(/\+/g, '%20'));

      if (key === 'hash') {
        providedHash = val;
      } else {
        params[key] = val;
      }
    }
  } catch (e) {
    return { valid: false, error: 'Malformed initData' };
  }

  if (!providedHash) {
    return { valid: false, error: 'Missing hash in initData' };
  }

  // Build sorted data_check_string
  const sortedKeys = Object.keys(params).sort();
  const dataCheckString = sortedKeys.map(k => `${k}=${params[k]}`).join('\n');

  // Compute expected HMAC hash using shared helper
  const expectedHash = computeTelegramInitDataHash(dataCheckString, botToken);

  if (!constantTimeCompare(expectedHash.toLowerCase(), providedHash.toLowerCase())) {
    return { valid: false, error: 'Signature mismatch' };
  }

  // Check auth_date expiration (24 hours = 86400 seconds)
  const authDate = Number(params.auth_date);
  if (!authDate || isNaN(authDate)) {
    return { valid: false, error: 'Missing or invalid auth_date' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > 86400) {
    return { valid: false, error: 'initData has expired (older than 24 hours)' };
  }

  // Extract user object
  let userObj = null;
  if (params.user) {
    try {
      userObj = JSON.parse(params.user);
    } catch (e) {
      return { valid: false, error: 'Failed to parse user JSON' };
    }
  }

  if (!userObj || !userObj.id) {
    return { valid: false, error: 'Missing user ID in initData' };
  }

  return {
    valid: true,
    user: {
      id: userObj.id,
      username: userObj.username || ''
    },
    authDate
  };
}

// ============================================================================
// FEE CALCULATION
// ============================================================================

/**
 * Calculates Year-1 tuition fees for partner and standard school categories.
 *
 * @param {string} department 'Engineering' or 'Management'
 * @param {string} grade BAC II grade ('A' through 'E')
 * @param {Object} config Typed configuration object
 * @return {{
 *   base: number,
 *   grade: string,
 *   department: string,
 *   partner: { baseRate: number, extraOffer: number, finalRate: number, yearly: number, semester: number, quarter: number },
 *   standard: { baseRate: number, extraOffer: number, finalRate: number, yearly: number, semester: number, quarter: number }
 * }}
 */
function calculateFees(department, grade, config) {
  const baseTuition = department === 'Engineering'
    ? config.base_engineering
    : config.base_management;

  const basePartnerRate = config.rates.partner[grade] || 0;
  const baseStandardRate = config.rates.standard[grade] || 0;
  const extraOffer = config.extra_offer || 0;

  const finalPartnerRate = basePartnerRate + extraOffer;
  const finalStandardRate = baseStandardRate + extraOffer;

  const yearlyPartner = roundToTwo(baseTuition * (1 - finalPartnerRate / 100));
  const semesterPartner = roundToTwo(yearlyPartner / 2);
  const quarterPartner = roundToTwo(yearlyPartner / 4);

  const yearlyStandard = roundToTwo(baseTuition * (1 - finalStandardRate / 100));
  const semesterStandard = roundToTwo(yearlyStandard / 2);
  const quarterStandard = roundToTwo(yearlyStandard / 4);

  return {
    base: baseTuition,
    grade,
    department,
    partner: {
      baseRate: basePartnerRate,
      extraOffer,
      finalRate: finalPartnerRate,
      yearly: yearlyPartner,
      semester: semesterPartner,
      quarter: quarterPartner
    },
    standard: {
      baseRate: baseStandardRate,
      extraOffer,
      finalRate: finalStandardRate,
      yearly: yearlyStandard,
      semester: semesterStandard,
      quarter: quarterStandard
    }
  };
}

// ============================================================================
// SUBMISSION HANDLER
// ============================================================================

/**
 * Handles student submission: verifies initData, checks rate limits, validates input,
 * locks sheet via tryLock, checks duplicates, generates Lead ID, writes to Leads tab, and sends Telegram alerts.
 *
 * @param {Object} body
 * @return {ContentService.TextOutput}
 */
function handleSubmit(body) {
  let botToken, adminChatId;
  try {
    botToken = getRequiredSecret('BOT_TOKEN');
    adminChatId = getRequiredSecret('ADMIN_CHAT_ID');
  } catch (err) {
    return createJsonResponse({ code: 'CONFIG_ERROR', message: 'Server configuration error' }, true);
  }

  // 1. Verify Telegram initData
  const verification = verifyInitData(body.initData, botToken);
  if (!verification.valid) {
    logEvent('WARN', 'Auth', `Rejected initData: ${verification.error}`);
    return createJsonResponse({ code: 'UNAUTHORIZED', message: 'Invalid or expired Telegram session. Please re-open the app.' }, true);
  }
  const telegramUser = verification.user;

  // 2. Rate-limit check (max 3 submissions per Telegram user ID per 10 minutes)
  const cache = CacheService.getScriptCache();
  const rateLimitKey = `rate_limit_user_${telegramUser.id}`;
  const currentSubmitsStr = cache.get(rateLimitKey);
  const currentSubmits = currentSubmitsStr ? parseInt(currentSubmitsStr, 10) : 0;

  if (currentSubmits >= RATE_LIMIT_MAX_SUBMITS) {
    logEvent('WARN', 'RateLimit', `Telegram user ${telegramUser.id} exceeded submit limit`);
    return createJsonResponse({ code: 'RATE_LIMITED', message: 'Too many submissions. Please wait 10 minutes before trying again.' }, true);
  }

  // 3. Read configuration and validate input
  let config;
  try {
    config = readConfig();
  } catch (err) {
    logEvent('ERROR', 'Submit', 'Failed to read config during submission', err);
    return createJsonResponse({ code: 'CONFIG_ERROR', message: 'Configuration error' }, true);
  }

  const validation = validateSubmission(body, config);
  if (!validation.valid) {
    return createJsonResponse({
      code: 'VALIDATION',
      message: 'Validation failed',
      fields: validation.errors
    }, true);
  }
  const clean = validation.clean;

  // 4. Calculate fees
  const fees = calculateFees(clean.department, clean.grade, config);

  // 5. Concurrency lock using tryLock(15000)
  const lock = LockService.getScriptLock();
  let hasLock = false;
  try {
    hasLock = lock.tryLock(15000);
  } catch (e) {
    logEvent('ERROR', 'Submit', 'Exception trying script lock', e);
    return createJsonResponse({ code: 'SERVER_ERROR', message: 'Server locking error' }, true);
  }

  if (!hasLock) {
    logEvent('ERROR', 'Submit', 'Timeout acquiring script lock for submission');
    return createJsonResponse({ code: 'SERVER_ERROR', message: 'Server busy, please retry in a moment.' }, true);
  }

  let leadId = '';
  let isDuplicate = false;

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAMES.LEADS);
    if (!sheet) {
      throw new Error(`Leads sheet "${SHEET_NAMES.LEADS}" not found`);
    }

    // Ensure capacity
    ensureLeadsCapacity(100);

    // Duplicate check on Phone column
    const phoneColIndex = getLeadColumnIndex('Phone');
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const phoneRange = sheet.getRange(2, phoneColIndex, lastRow - 1, 1);
      const textFinder = phoneRange.createTextFinder(clean.phone).matchEntireCell(true);
      const matches = textFinder.findAll();
      if (matches && matches.length > 0) {
        isDuplicate = true;
      }
    }

    // Generate Lead ID: KIT-YYMMDD-NNNN
    const now = new Date();
    const dateStr = Utilities.formatDate(now, 'Asia/Phnom_Penh', 'yyMMdd');
    const seqPropKey = `lead_seq_${dateStr}`;
    const props = PropertiesService.getScriptProperties();
    const currentSeqStr = props.getProperty(seqPropKey);
    const nextSeq = currentSeqStr ? parseInt(currentSeqStr, 10) + 1 : 1;
    props.setProperty(seqPropKey, String(nextSeq));

    const seqPadded = String(nextSeq).padStart(4, '0');
    leadId = `KIT-${dateStr}-${seqPadded}`;

    // Build row values strictly mapped by LEADS_HEADERS
    const rowMap = {
      'Lead ID': leadId,
      'Timestamp': now,
      'Name': sanitizeForSheet(clean.name),
      'Gender': clean.gender,
      'Phone': clean.phone,
      'Parent Phone': clean.parentPhone ? clean.parentPhone : '',
      'Email': sanitizeForSheet(clean.email),
      'Province': clean.province,
      'High School': sanitizeForSheet(clean.highSchool),
      'Department': clean.department,
      'Major': clean.major,
      'Grade': clean.grade,
      'Partner %': fees.partner.finalRate,
      'Standard %': fees.standard.finalRate,
      'Partner Fee / Year': fees.partner.yearly,
      'Standard Fee / Year': fees.standard.yearly,
      'Question': clean.question ? sanitizeForSheet(clean.question) : '',
      'Telegram ID': String(telegramUser.id),
      'Telegram Username': telegramUser.username ? sanitizeForSheet(telegramUser.username) : '',
      'Status': 'New',
      'Counselor': '',
      'Contacted At': '',
      'Duplicate': isDuplicate ? 'Yes' : 'No'
    };

    const rowValues = LEADS_HEADERS.map(h => rowMap[h] !== undefined ? rowMap[h] : '');
    const newRowIndex = sheet.getLastRow() + 1;
    sheet.getRange(newRowIndex, 1, 1, LEADS_HEADERS.length).setValues([rowValues]);

    // Update rate limit cache counter (600s TTL)
    cache.put(rateLimitKey, String(currentSubmits + 1), RATE_LIMIT_WINDOW_SEC);

  } catch (err) {
    logEvent('ERROR', 'Submit', `Failed writing lead: ${err.message}`, err);
    return createJsonResponse({ code: 'SERVER_ERROR', message: 'Failed to record lead in database.' }, true);
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      Logger.log(`Failed releasing lock: ${e.message}`);
    }
  }

  // 6. Send Telegram notifications (non-blocking for client response)
  sendSubmissionNotifications({
    botToken,
    adminChatId,
    leadId,
    clean,
    fees,
    telegramUser,
    isDuplicate,
    config
  });

  return createJsonResponse({
    leadId,
    fees,
    callbackHours: config.callback_hours,
    admissionFee: config.admission_fee
  }, false);
}

// ============================================================================
// TELEGRAM MESSAGING
// ============================================================================

/**
 * Sends an HTML message via the Telegram Bot API.
 * Mutes HTTP exceptions and logs errors appropriately.
 *
 * @param {string|number} chatId
 * @param {string} htmlText
 * @param {Object} [replyMarkup]
 * @return {boolean} True if sent successfully
 */
function sendTelegramMessage(chatId, htmlText, replyMarkup) {
  let botToken;
  try {
    botToken = getRequiredSecret('BOT_TOKEN');
  } catch (e) {
    return false;
  }

  const payload = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: 'HTML'
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, options);
    const respCode = response.getResponseCode();
    const respText = response.getContentText();
    let result = null;
    try {
      result = JSON.parse(respText);
    } catch (e) {
      result = { ok: false, description: respText };
    }

    if (result && result.ok) {
      return true;
    }

    if (respCode === 403) {
      logEvent('WARN', 'Telegram', `Cannot message chat ${chatId} (bot blocked or not started): ${result.description || ''}`);
    } else {
      logEvent('ERROR', 'Telegram', `Failed sending message to ${chatId} (${respCode}): ${result.description || respText}`);
    }
    return false;
  } catch (err) {
    logEvent('ERROR', 'Telegram', `Exception sending Telegram message to ${chatId}: ${err.message}`, err);
    return false;
  }
}

/**
 * Dispatches both Admin and Student notification messages.
 * Uses plain text +855 format for phone numbers without tel: links (which Telegram rejects).
 *
 * @param {Object} ctx
 */
function sendSubmissionNotifications(ctx) {
  const { adminChatId, leadId, clean, fees, telegramUser, isDuplicate, config } = ctx;

  // Admin Notification
  try {
    const intlPhone = formatInternationalPhone(clean.phone);
    const intlParentPhone = clean.parentPhone ? formatInternationalPhone(clean.parentPhone) : 'N/A';
    const tgUsernameText = telegramUser.username ? `@${escapeHtml(telegramUser.username)}` : 'None';
    const dupAlert = isDuplicate ? '⚠️ <b>Duplicate Phone Number</b>\n' : '';

    const adminHtml =
      `🚨 <b>New KIT Admission Lead</b>\n` +
      `${dupAlert}` +
      `🆔 <b>Lead ID:</b> <code>${escapeHtml(leadId)}</code>\n\n` +
      `👤 <b>Name:</b> ${escapeHtml(clean.name)} (${escapeHtml(clean.gender)})\n` +
      `📞 <b>Phone:</b> ${intlPhone}\n` +
      `👪 <b>Parent Phone:</b> ${intlParentPhone}\n` +
      `📧 <b>Email:</b> ${escapeHtml(clean.email)}\n` +
      `📍 <b>Province:</b> ${escapeHtml(clean.province)}\n` +
      `🏫 <b>School:</b> ${escapeHtml(clean.highSchool)}\n` +
      `🏛 <b>Department:</b> ${escapeHtml(clean.department)}\n` +
      `🎓 <b>Major:</b> ${escapeHtml(clean.major)}\n` +
      `📝 <b>Grade:</b> Grade ${escapeHtml(clean.grade)}\n\n` +
      `💰 <b>Tuition Estimates:</b>\n` +
      `• Partner: ${fees.partner.finalRate}% scholarship → ${formatMoney(fees.partner.yearly)}/yr\n` +
      `• Standard: ${fees.standard.finalRate}% scholarship → ${formatMoney(fees.standard.yearly)}/yr\n\n` +
      `💬 <b>Question:</b> ${clean.question ? escapeHtml(clean.question) : 'None'}\n` +
      `📱 <b>Telegram:</b> ${tgUsernameText} (ID: <code>${telegramUser.id}</code>)`;

    sendTelegramMessage(adminChatId, adminHtml);
  } catch (err) {
    logEvent('ERROR', 'Telegram', `Failed dispatching admin alert: ${err.message}`, err);
  }

  // Student Notification
  if (telegramUser && telegramUser.id) {
    try {
      const studentHtml =
        `🎓 <b>Dear ${escapeHtml(clean.name)},</b>\n\n` +
        `Thank you for your interest in <b>Kirirom Institute of Technology (KIT)</b>!\n\n` +
        `Here is your Year-1 tuition estimate for <b>${escapeHtml(clean.major)}</b> (Grade ${escapeHtml(clean.grade)}):\n\n` +
        `🏫 <b>KIT-Partner High School</b>\n` +
        `• Scholarship: ${fees.partner.baseRate}% + ${fees.partner.extraOffer}% = <b>${fees.partner.finalRate}%</b>\n` +
        `• Pay yearly: <b>${formatMoney(fees.partner.yearly)}</b>\n` +
        `• Pay per semester: <b>${formatMoney(fees.partner.semester)}</b>\n` +
        `• Pay per quarter: <b>${formatMoney(fees.partner.quarter)}</b>\n\n` +
        `🏛 <b>Standard High School</b>\n` +
        `• Scholarship: ${fees.standard.baseRate}% + ${fees.standard.extraOffer}% = <b>${fees.standard.finalRate}%</b>\n` +
        `• Pay yearly: <b>${formatMoney(fees.standard.yearly)}</b>\n` +
        `• Pay per semester: <b>${formatMoney(fees.standard.semester)}</b>\n` +
        `• Pay per quarter: <b>${formatMoney(fees.standard.quarter)}</b>\n\n` +
        `• One-time admission fee of ${formatMoney(config.admission_fee)} is not included.\n` +
        `• Estimate only, subject to KIT's confirmation. From Year 2, scholarships are performance-based.\n\n` +
        `📞 A counselor may call you within ${config.callback_hours} hours.\n\n` +
        `🏛️ Book a campus visit: 010 575 011, 099 317 774`;

      sendTelegramMessage(telegramUser.id, studentHtml);
    } catch (err) {
      logEvent('ERROR', 'Telegram', `Failed dispatching student message: ${err.message}`, err);
    }
  }
}

// ============================================================================
// WEBHOOK HANDLER
// ============================================================================

/**
 * Handles Telegram Bot webhook updates.
 * Deduplicates update_id and responds to /start with a welcome button only in private chats.
 *
 * @param {Object} update Telegram update object
 * @return {ContentService.TextOutput}
 */
function handleTelegramWebhook(update) {
  const updateId = Number(update.update_id);

  // Telegram retries an update until it gets a clean HTTP 200. Update IDs only ever
  // increase, so a permanent high-water mark ignores every retry, however late it arrives.
  // (The previous 6-hour cache let retries through after it expired.)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return webhookOk();
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const lastId = Number(props.getProperty('tg_last_update_id') || 0);
    if (!isFinite(updateId) || updateId <= lastId) {
      return webhookOk();
    }
    props.setProperty('tg_last_update_id', String(updateId));
  } finally {
    lock.releaseLock();
  }

  const message = update.message;
  if (!message || !message.text) {
    return webhookOk();
  }

  // Only reply to /start when in a private chat
  if (message.text.startsWith('/start') && message.chat && message.chat.type === 'private') {
    let webAppUrl;
    try {
      webAppUrl = getRequiredSecret('WEBAPP_URL');
    } catch (err) {
      logEvent('ERROR', 'Webhook', 'WEBAPP_URL not set in properties');
      return webhookOk();
    }

    const chatId = message.chat.id;
    const welcomeHtml =
      `🎓 <b>Welcome to KIT Admissions!</b>\n\n` +
      `Calculate your Year-1 tuition scholarship estimate for Kirirom Institute of Technology and register your interest in just 2 minutes.`;

    const keyboard = {
      inline_keyboard: [[
        { text: 'Open Admissions App', web_app: { url: webAppUrl } }
      ]]
    };

    sendTelegramMessage(chatId, welcomeHtml, keyboard);
  }

  return webhookOk();
}

/**
 * Webhook acknowledgement. ContentService output is served through a 302 redirect,
 * which Telegram counts as a failed delivery and retries; HtmlService output is
 * returned directly with HTTP 200.
 *
 * @return {HtmlService.HtmlOutput}
 */
function webhookOk() {
  return HtmlService.createHtmlOutput('OK');
}
