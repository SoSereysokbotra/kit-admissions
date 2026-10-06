/**
 * KIT Admissions Mini App - Database Setup & Configuration
 * 
 * Sets up and maintains the Google Spreadsheet structure:
 * 1. Leads tab: stores submitted student leads with data validation & overdue alert.
 * 2. Config tab: key-value settings editable by admissions staff without code changes.
 * 3. Log tab: audit and error log for backend events.
 * 
 * All functions are idempotent: running setup() repeatedly preserves existing data and staff edits.
 */

// ============================================================================
// CONSTANTS & SCHEMAS
// ============================================================================

const SHEET_NAMES = Object.freeze({
  LEADS: 'Leads',
  CONFIG: 'Config',
  LOG: 'Log'
});

/**
 * Single source of truth for the Leads sheet columns.
 * Column positions in code MUST always be derived from this array via getLeadColumnIndex().
 */
const LEADS_HEADERS = Object.freeze([
  'Lead ID',
  'Timestamp',
  'Name',
  'Gender',
  'Phone',
  'Parent Phone',
  'Email',
  'Province',
  'High School',
  'Department',
  'Major',
  'Grade',
  'Partner %',
  'Standard %',
  'Partner Fee / Year',
  'Standard Fee / Year',
  'Question',
  'Telegram ID',
  'Telegram Username',
  'Status',
  'Counselor',
  'Contacted At',
  'Duplicate'
]);

/**
 * Sensible initial column widths (in pixels) for the Leads sheet.
 */
const LEADS_COLUMN_WIDTHS = Object.freeze({
  'Lead ID': 140,
  'Timestamp': 150,
  'Name': 160,
  'Gender': 90,
  'Phone': 120,
  'Parent Phone': 120,
  'Email': 190,
  'Province': 130,
  'High School': 180,
  'Department': 130,
  'Major': 240,
  'Grade': 80,
  'Partner %': 100,
  'Standard %': 100,
  'Partner Fee / Year': 140,
  'Standard Fee / Year': 140,
  'Question': 220,
  'Telegram ID': 130,
  'Telegram Username': 150,
  'Status': 130,
  'Counselor': 140,
  'Contacted At': 130,
  'Duplicate': 90
});

const STATUS_OPTIONS = Object.freeze([
  'New',
  'Contacted',
  'No answer',
  'Applied',
  'Not interested'
]);

const CONFIG_HEADERS = Object.freeze([
  'Key',
  'Value',
  'Description'
]);

const LOG_HEADERS = Object.freeze([
  'Timestamp',
  'Level',
  'Source',
  'Message',
  'Details'
]);

/**
 * Default configuration values seeded into the Config tab.
 * Base tuition, extra offer points, fee, callback window, base grade rates, and department majors.
 */
const DEFAULT_CONFIG_ENTRIES = Object.freeze([
  { key: 'base_engineering', value: 5000, description: 'Base annual tuition for Engineering ($)' },
  { key: 'base_management', value: 4000, description: 'Base annual tuition for Management ($)' },
  { key: 'extra_offer', value: 10, description: 'Extra scholarship percentage points for mini app users' },
  { key: 'admission_fee', value: 500, description: 'One-time admission fee ($)' },
  { key: 'callback_hours', value: 24, description: 'Promised counselor callback response window in hours' },
  { key: 'rate_partner_A', value: 55, description: 'Partner school base scholarship rate for Grade A (%)' },
  { key: 'rate_partner_B', value: 40, description: 'Partner school base scholarship rate for Grade B (%)' },
  { key: 'rate_partner_C', value: 20, description: 'Partner school base scholarship rate for Grade C (%)' },
  { key: 'rate_partner_D', value: 10, description: 'Partner school base scholarship rate for Grade D (%)' },
  { key: 'rate_partner_E', value: 5, description: 'Partner school base scholarship rate for Grade E (%)' },
  { key: 'rate_standard_A', value: 50, description: 'Standard school base scholarship rate for Grade A (%)' },
  { key: 'rate_standard_B', value: 30, description: 'Standard school base scholarship rate for Grade B (%)' },
  { key: 'rate_standard_C', value: 10, description: 'Standard school base scholarship rate for Grade C (%)' },
  { key: 'rate_standard_D', value: 5, description: 'Standard school base scholarship rate for Grade D (%)' },
  { key: 'rate_standard_E', value: 0, description: 'Standard school base scholarship rate for Grade E (%)' },
  { key: 'majors_engineering', value: 'Software Engineering; AI & Machine Learning; Cyber Security', description: 'Available majors for Engineering (semicolon separated)' },
  { key: 'majors_management', value: 'Tourism DX & Hospitality Management; Business Administration with Applied AI', description: 'Available majors for Management (semicolon separated)' }
]);

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Returns the 1-based column index for a given header in the Leads sheet.
 * Throws an error if the header is not found.
 *
 * @param {string} headerName
 * @return {number} 1-based column index
 */
function getLeadColumnIndex(headerName) {
  const index = LEADS_HEADERS.indexOf(headerName);
  if (index === -1) {
    throw new Error(`Header "${headerName}" not found in LEADS_HEADERS`);
  }
  return index + 1;
}

/**
 * Converts a 1-based column index to an A1-notation column letter (e.g., 1 -> 'A', 23 -> 'W').
 *
 * @param {number} column 1-based column index
 * @return {string} Column letter
 */
function columnToLetter(column) {
  let temp;
  let letter = '';
  let col = column;
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    col = Math.floor((col - temp - 1) / 26);
  }
  return letter;
}

// ============================================================================
// MAIN SETUP FUNCTION
// ============================================================================

/**
 * Creates or repairs all required tabs and formatting in the spreadsheet.
 * Idempotent: running it multiple times will not duplicate formatting or overwrite existing data.
 *
 * @return {Object} Status summary
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No active spreadsheet found. Please bind this script to a Google Spreadsheet or open one.');
  }

  // Ensure spreadsheet timezone matches Phnom Penh time
  ss.setSpreadsheetTimeZone('Asia/Phnom_Penh');

  Logger.log('Starting KIT Admissions spreadsheet setup / repair...');

  setupLeadsSheet(ss);
  setupConfigSheet(ss);
  setupLogSheet(ss);

  // If a default empty 'Sheet1' exists from workbook creation, safely remove it
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && defaultSheet.getLastColumn() === 0 && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
      Logger.log('Removed empty default "Sheet1".');
    } catch (e) {
      Logger.log(`Note: Default Sheet1 could not be deleted: ${e.message}`);
    }
  }

  logEvent('INFO', 'Setup', 'Spreadsheet setup/repair completed successfully');
  Logger.log('KIT Admissions spreadsheet setup / repair completed successfully.');

  return {
    status: 'success',
    message: 'Setup completed successfully. All tabs (Leads, Config, Log) configured.'
  };
}

/**
 * Creates or repairs the Leads sheet.
 * Never overwrites row 1 if data exists with mismatched headers; throws and logs an error instead.
 * Ensures the sheet has at least 5000 rows and formats the full range.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 */
function setupLeadsSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.LEADS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.LEADS);
    sheet.appendRow([...LEADS_HEADERS]);
  } else if (sheet.getLastRow() === 0) {
    // Only write headers when the sheet is completely empty
    sheet.appendRow([...LEADS_HEADERS]);
  } else {
    // Sheet has existing content - verify headers match exactly
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const headersMatch = currentHeaders.length >= LEADS_HEADERS.length &&
      LEADS_HEADERS.every((h, i) => currentHeaders[i] === h);

    if (!headersMatch) {
      const foundHeaders = currentHeaders.map(h => String(h).trim()).filter(Boolean);
      const errMsg = `Leads sheet header mismatch with existing rows. Expected headers: [${LEADS_HEADERS.join(', ')}], Found headers: [${foundHeaders.join(', ')}]`;
      logEvent('ERROR', 'Setup', errMsg);
      throw new Error(errMsg);
    }
  }

  // Ensure Leads sheet has at least 5000 rows
  const minRows = 5000;
  if (sheet.getMaxRows() < minRows) {
    const rowsToAdd = minRows - sheet.getMaxRows();
    sheet.insertRowsAfter(sheet.getMaxRows(), rowsToAdd);
  }

  // Apply complete formatting across full row capacity
  applyLeadsFormatting(sheet);
}

/**
 * Applies header styling, column widths, plain text phone formatting,
 * dropdown and date data validations, alternating row colours, and conditional formatting
 * across the entire range of the Leads sheet.
 *
 * @param {SpreadsheetApp.Sheet} sheet
 */
function applyLeadsFormatting(sheet) {
  const numColumns = LEADS_HEADERS.length;
  const maxRows = sheet.getMaxRows();

  // 1. Freeze header row & style header
  sheet.setFrozenRows(1);
  const headerRange = sheet.getRange(1, 1, 1, numColumns);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#e6f4ea'); // Professional KIT light-green tint
  headerRange.setFontColor('#137333');  // Dark green text
  headerRange.setWrap(false);

  // 2. Set sensible column widths
  Object.keys(LEADS_COLUMN_WIDTHS).forEach(header => {
    const colIdx = getLeadColumnIndex(header);
    sheet.setColumnWidth(colIdx, LEADS_COLUMN_WIDTHS[header]);
  });

  // 3. Alternating row colours across all rows (idempotent: update range if exists)
  const existingBandings = sheet.getBandings();
  if (!existingBandings || existingBandings.length === 0) {
    sheet.getRange(1, 1, maxRows, numColumns)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  } else {
    existingBandings[0].setRange(sheet.getRange(1, 1, maxRows, numColumns));
  }

  // 4. Format Phone & Parent Phone columns as plain text ('@') for all data rows
  const phoneCol = getLeadColumnIndex('Phone');
  const parentPhoneCol = getLeadColumnIndex('Parent Phone');
  if (maxRows > 1) {
    sheet.getRange(2, phoneCol, maxRows - 1, 1).setNumberFormat('@');
    sheet.getRange(2, parentPhoneCol, maxRows - 1, 1).setNumberFormat('@');
  }

  // Show date AND time so counselors can judge the 24-hour callback window
  sheet.getRange(2, getLeadColumnIndex('Timestamp'), maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  // 5. Data validation for Status column across all data rows
  const statusCol = getLeadColumnIndex('Status');
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText(`Select a valid Status: ${STATUS_OPTIONS.join(', ')}`)
    .build();
  sheet.getRange(2, statusCol, maxRows - 1, 1).setDataValidation(statusRule);

  // 6. Data validation for Contacted At column across all data rows
  const contactedAtCol = getLeadColumnIndex('Contacted At');
  const dateRule = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText('Must be a valid date')
    .build();
  sheet.getRange(2, contactedAtCol, maxRows - 1, 1).setDataValidation(dateRule);

  // 7. Conditional formatting: row turns red when Status = "New" and Timestamp is older than 24 hours
  const statusColLetter = columnToLetter(statusCol);
  const timestampColLetter = columnToLetter(getLeadColumnIndex('Timestamp'));
  const lastColLetter = columnToLetter(numColumns);
  const overdueFormula = `=AND($${statusColLetter}2="New", $${timestampColLetter}2<>"", (NOW()-$${timestampColLetter}2)>=1)`;

  const overdueRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(overdueFormula)
    .setBackground('#fce8e6') // Soft red highlight
    .setFontColor('#c5221f')   // Dark red text for legibility
    .setRanges([sheet.getRange(`A2:${lastColLetter}${maxRows}`)])
    .build();

  // Keep existing rules created by users/admins; only replace our setup rule identified by exact formula
  const existingRules = sheet.getConditionalFormatRules();
  const otherRules = existingRules.filter(rule => {
    const boolCond = rule.getBooleanCondition();
    if (!boolCond) return true;
    if (boolCond.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA) {
      const vals = boolCond.getCriteriaValues();
      if (vals && vals.length > 0 && String(vals[0]).trim() === overdueFormula.trim()) {
        return false; // remove old overdue rule
      }
    }
    return true;
  });

  sheet.setConditionalFormatRules(otherRules.concat([overdueRule]));
}

/**
 * Ensures the Leads sheet has sufficient empty rows remaining for incoming submissions.
 * Called before writing new leads in Phase 2.
 * If fewer than minFreeRows (default 100) empty rows remain, inserts additional rows
 * and extends all column validations, formats, banding, and conditional formatting.
 *
 * @param {number} [minFreeRows=100] Minimum free rows required
 * @return {number} Current total rows in Leads sheet
 */
function ensureLeadsCapacity(minFreeRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No active spreadsheet found.');
  }
  const sheet = ss.getSheetByName(SHEET_NAMES.LEADS);
  if (!sheet) {
    throw new Error(`Leads sheet "${SHEET_NAMES.LEADS}" not found. Please run setup() first.`);
  }

  const threshold = (typeof minFreeRows === 'number' && minFreeRows > 0) ? minFreeRows : 100;
  const maxRows = sheet.getMaxRows();
  const lastRow = sheet.getLastRow();
  const freeRows = maxRows - lastRow;

  if (freeRows < threshold) {
    const rowsToAdd = Math.max(1000, threshold - freeRows);
    sheet.insertRowsAfter(maxRows, rowsToAdd);
    applyLeadsFormatting(sheet);
    logEvent('INFO', 'Setup', `Expanded Leads sheet capacity by ${rowsToAdd} rows (total rows: ${sheet.getMaxRows()})`);
  }

  return sheet.getMaxRows();
}

/**
 * Creates or repairs the Config sheet.
 * Preserves any existing config values edited by admissions staff; only adds missing keys.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 */
function setupConfigSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.CONFIG);
    sheet.appendRow([...CONFIG_HEADERS]);
    const rowsToInsert = DEFAULT_CONFIG_ENTRIES.map(e => [e.key, e.value, e.description]);
    sheet.getRange(2, 1, rowsToInsert.length, 3).setValues(rowsToInsert);
  } else {
    // Read existing keys to preserve staff edits
    const lastRow = sheet.getLastRow();
    const existingKeys = new Set();
    if (lastRow >= 2) {
      const existingData = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      existingData.forEach(row => {
        if (row[0]) {
          existingKeys.add(String(row[0]).trim().toLowerCase());
        }
      });
    }

    // Identify only missing keys
    const missingEntries = DEFAULT_CONFIG_ENTRIES.filter(e => !existingKeys.has(e.key.toLowerCase()));
    if (missingEntries.length > 0) {
      const rowsToAppend = missingEntries.map(e => [e.key, e.value, e.description]);
      sheet.getRange(lastRow + 1, 1, rowsToAppend.length, 3).setValues(rowsToAppend);
      Logger.log(`Added ${missingEntries.length} missing configuration keys to Config sheet.`);
    }
  }

  // Format header row
  sheet.setFrozenRows(1);
  const headerRange = sheet.getRange(1, 1, 1, CONFIG_HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f1f3f4');
  headerRange.setFontColor('#202124');

  sheet.setColumnWidth(1, 200); // Key
  sheet.setColumnWidth(2, 360); // Value
  sheet.setColumnWidth(3, 420); // Description
}

/**
 * Creates or repairs the Log sheet.
 * Preserves all existing logs. Sets the Timestamp column to number format "yyyy-mm-dd hh:mm:ss".
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 */
function setupLogSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.LOG);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.LOG);
    sheet.appendRow([...LOG_HEADERS]);
  } else if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.appendRow([...LOG_HEADERS]);
  }

  // Format header row
  sheet.setFrozenRows(1);
  const headerRange = sheet.getRange(1, 1, 1, LOG_HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f1f3f4');
  headerRange.setFontColor('#202124');

  // Format Timestamp column as yyyy-mm-dd hh:mm:ss for all data rows
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) {
    sheet.getRange(2, 1, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  sheet.setColumnWidth(1, 180); // Timestamp
  sheet.setColumnWidth(2, 90);  // Level
  sheet.setColumnWidth(3, 120); // Source
  sheet.setColumnWidth(4, 320); // Message
  sheet.setColumnWidth(5, 450); // Details
}

// ============================================================================
// CONFIGURATION READER
// ============================================================================

/**
 * Reads and validates the Config sheet, returning a typed configuration object.
 * Throws a descriptive error if any required key is missing, invalid, or duplicated.
 * Validates that every grade rate + extra_offer does not exceed 100%.
 *
 * @return {{
 *   base_engineering: number,
 *   base_management: number,
 *   extra_offer: number,
 *   admission_fee: number,
 *   callback_hours: number,
 *   rates: {
 *     partner: { A: number, B: number, C: number, D: number, E: number },
 *     standard: { A: number, B: number, C: number, D: number, E: number }
 *   },
 *   majors: {
 *     Engineering: string[],
 *     Management: string[]
 *   }
 * }}
 */
function readConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No active spreadsheet found. Please bind this script to a Google Spreadsheet or open one.');
  }

  const sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (!sheet) {
    throw new Error(`Config sheet "${SHEET_NAMES.CONFIG}" not found. Please run setup() first.`);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error(`Config sheet "${SHEET_NAMES.CONFIG}" is empty. Please run setup() to populate defaults.`);
  }

  const rawValues = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const rawMap = {};
  const seenKeys = new Set();

  for (let i = 0; i < rawValues.length; i++) {
    const rawKey = rawValues[i][0];
    if (rawKey === '' || rawKey === null || rawKey === undefined) continue;
    const keyStr = String(rawKey).trim();
    if (!keyStr) continue;

    const lowerKey = keyStr.toLowerCase();
    if (seenKeys.has(lowerKey)) {
      throw new Error(`Duplicate key found in Config sheet: "${keyStr}"`);
    }
    seenKeys.add(lowerKey);
    rawMap[lowerKey] = rawValues[i][1];
  }

  /**
   * Helper to retrieve and parse a required numeric configuration key.
   *
   * @param {string} keyName
   * @return {number}
   */
  function getNumber(keyName) {
    const lowerKey = keyName.toLowerCase();
    if (!(lowerKey in rawMap)) {
      throw new Error(`Missing required config key: "${keyName}"`);
    }
    const val = rawMap[lowerKey];
    if (val === '' || val === null || val === undefined) {
      throw new Error(`Config key "${keyName}" cannot be empty`);
    }
    const num = Number(val);
    if (isNaN(num)) {
      throw new Error(`Config key "${keyName}" must be a valid number, got: "${val}"`);
    }
    return num;
  }

  const baseEngineering = getNumber('base_engineering');
  const baseManagement = getNumber('base_management');
  const extraOffer = getNumber('extra_offer');
  const admissionFee = getNumber('admission_fee');
  const callbackHours = getNumber('callback_hours');

  if (baseEngineering <= 0) {
    throw new Error('Config key "base_engineering" must be greater than 0');
  }
  if (baseManagement <= 0) {
    throw new Error('Config key "base_management" must be greater than 0');
  }
  if (extraOffer < 0 || extraOffer > 100) {
    throw new Error('Config key "extra_offer" must be between 0 and 100');
  }
  if (admissionFee < 0) {
    throw new Error('Config key "admission_fee" cannot be negative');
  }
  if (callbackHours <= 0) {
    throw new Error('Config key "callback_hours" must be greater than 0');
  }

  const grades = ['A', 'B', 'C', 'D', 'E'];

  /**
   * Helper to parse and validate individual grade rates for a department type ('partner' or 'standard').
   * Only individual keys (rate_partner_A..E / rate_standard_A..E) are supported.
   * Validates that base rate >= 0 and (base rate + extra_offer) <= 100.
   *
   * @param {string} type 'partner' or 'standard'
   * @return {{ A: number, B: number, C: number, D: number, E: number }}
   */
  function parseRates(type) {
    const result = {};
    const typeLower = type.toLowerCase();

    for (const g of grades) {
      const keyName = `rate_${typeLower}_${g}`;
      const num = getNumber(keyName);

      if (num < 0 || num > 100) {
        throw new Error(`Config key "${keyName}" must be between 0 and 100, got: ${num}`);
      }

      if (num + extraOffer > 100) {
        throw new Error(`Config key "${keyName}" rate plus extra_offer exceeds 100% (${num}% + ${extraOffer}% = ${num + extraOffer}%)`);
      }

      result[g] = num;
    }

    return result;
  }

  const partnerRates = parseRates('partner');
  const standardRates = parseRates('standard');

  /**
   * Helper to parse department majors list.
   *
   * @param {string} department 'Engineering' or 'Management'
   * @return {string[]}
   */
  function parseMajors(department) {
    const key = `majors_${department.toLowerCase()}`;
    if (!(key in rawMap)) {
      throw new Error(`Missing majors configuration for department "${department}" (key: "${key}")`);
    }
    const val = rawMap[key];
    if (val === '' || val === null || val === undefined) {
      throw new Error(`Config key "${key}" cannot be empty`);
    }
    let list = [];
    if (Array.isArray(val)) {
      list = val.map(String).map(s => s.trim()).filter(Boolean);
    } else {
      const strVal = String(val);
      // Split on semicolon first, fallback to comma if no semicolon
      const delimiter = strVal.includes(';') ? ';' : ',';
      list = strVal.split(delimiter).map(s => s.trim()).filter(Boolean);
    }
    if (list.length === 0) {
      throw new Error(`Department "${department}" must have at least one major specified in "${key}"`);
    }
    return list;
  }

  const engineeringMajors = parseMajors('Engineering');
  const managementMajors = parseMajors('Management');

  return {
    base_engineering: baseEngineering,
    base_management: baseManagement,
    extra_offer: extraOffer,
    admission_fee: admissionFee,
    callback_hours: callbackHours,
    rates: {
      partner: partnerRates,
      standard: standardRates
    },
    majors: {
      Engineering: engineeringMajors,
      Management: managementMajors
    }
  };
}

// ============================================================================
// LOGGING HELPER
// ============================================================================

/**
 * Appends an event row to the Log tab.
 * Safely handles object serialization and falls back to Logger.log if the sheet is unreachable.
 * Writes timestamp as a real Date object and formats column 1 as "yyyy-mm-dd hh:mm:ss".
 *
 * @param {string} level 'INFO', 'WARN', or 'ERROR'
 * @param {string} source Component/module name (e.g. 'Setup', 'API', 'Telegram')
 * @param {string} message Human-readable log message
 * @param {*} [details] Optional details object, error, or string
 */
function logEvent(level, source, message, details) {
  const normLevel = String(level || 'INFO').toUpperCase();
  const normSource = String(source || 'App');
  const normMessage = String(message || '');

  let detailsStr = '';
  if (details !== undefined && details !== null) {
    if (details instanceof Error) {
      detailsStr = details.stack || details.message;
    } else if (typeof details === 'object') {
      try {
        detailsStr = JSON.stringify(details);
      } catch (e) {
        detailsStr = String(details);
      }
    } else {
      detailsStr = String(details);
    }
  }

  Logger.log(`[${normLevel}] [${normSource}] ${normMessage}${detailsStr ? ' | ' + detailsStr : ''}`);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;

    let sheet = ss.getSheetByName(SHEET_NAMES.LOG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAMES.LOG);
      sheet.appendRow(LOG_HEADERS);
      sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    const timestamp = new Date();
    sheet.appendRow([
      timestamp,
      normLevel,
      normSource,
      normMessage,
      detailsStr
    ]);

    // Ensure cell number format is yyyy-mm-dd hh:mm:ss
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } catch (err) {
    Logger.log(`Failed to write to Log sheet: ${err.message}`);
  }
}

// ============================================================================
// SCRIPT PROPERTIES & ADMIN HELPERS (PHASE 4)
// ============================================================================

const REQUIRED_SCRIPT_PROPERTIES = Object.freeze([
  'BOT_TOKEN',
  'ADMIN_CHAT_ID',
  'WEBAPP_URL',
  'WEBHOOK_SECRET',
  'API_URL'
]);

/**
 * Universal helper to call Telegram Bot API methods with muteHttpExceptions enabled.
 *
 * @param {string} method Telegram method name (e.g. 'getUpdates', 'setWebhook')
 * @param {Object} [payload={}] Parameters for the API call
 * @return {Object} Parsed JSON response from Telegram or error description object
 */
function callTelegramApi(method, payload) {
  let botToken;
  try {
    const props = PropertiesService.getScriptProperties();
    botToken = props.getProperty('BOT_TOKEN');
  } catch (e) {
    Logger.log(`Failed to read BOT_TOKEN: ${e.message}`);
    return { ok: false, description: e.message };
  }

  if (!botToken) {
    const msg = 'BOT_TOKEN is missing in Script Properties.';
    Logger.log(msg);
    return { ok: false, description: msg };
  }

  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const text = response.getContentText();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { ok: false, description: `HTTP ${code}: ${text}` };
    }
    return json;
  } catch (err) {
    Logger.log(`Telegram API call error (${method}): ${err.message}`);
    return { ok: false, description: err.message };
  }
}

/**
 * Generates a cryptographically random 32-char [A-Za-z0-9] secret,
 * saves it to Script Property WEBHOOK_SECRET, and logs it.
 *
 * @return {string} The generated webhook secret
 */
function generateWebhookSecret() {
  // Utilities.getUuid() is backed by a secure random generator (Math.random() is not)
  const secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 32);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('WEBHOOK_SECRET', secret);
  Logger.log(`✅ Generated WEBHOOK_SECRET (${secret.substring(0, 4)}…) and saved it to Script Properties.`);
  logEvent('INFO', 'Setup', 'Generated and saved WEBHOOK_SECRET');
  return secret;
}

/**
 * Calls Telegram getUpdates to inspect recent messages and display chat IDs.
 * The webhook must be deleted first for getUpdates to function.
 */
function findAdminChatId() {
  const res = callTelegramApi('getUpdates', {});
  if (!res.ok) {
    const desc = res.description || '';
    if (desc.toLowerCase().includes('webhook') || res.error_code === 409) {
      Logger.log(`⚠️ Telegram error: "${desc}"`);
      Logger.log('👉 A webhook is currently active! Telegram prevents calling getUpdates while a webhook is set.');
      Logger.log('   Steps to find your Admin Chat ID:');
      Logger.log('   1. Run deleteWebhook() in Apps Script editor.');
      Logger.log('   2. Send a new text message in your Telegram admin group.');
      Logger.log('   3. Re-run findAdminChatId().');
      Logger.log('   4. After saving ADMIN_CHAT_ID, run setWebhook() to re-enable webhook.');
      return;
    }
    Logger.log(`❌ Failed to retrieve updates: ${desc}`);
    return;
  }

  const updates = res.result || [];
  if (updates.length === 0) {
    Logger.log('⚠️ No updates found. Make sure the bot is added to your admin group and a message was sent there recently, then re-run findAdminChatId().');
    return;
  }

  const chats = {};
  updates.forEach(u => {
    // Adding the bot to a group produces a my_chat_member update; messages produce message updates
    const source = u.message || u.channel_post || u.my_chat_member;
    const chat = source && source.chat;
    if (chat) {
      chats[chat.id] = {
        id: chat.id,
        type: chat.type,
        title: chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || 'Direct / Private'
      };
    }
  });

  Logger.log('--- RECENT CHATS FOUND ---');
  Object.values(chats).forEach(c => {
    Logger.log(`• Chat ID: ${c.id} | Type: ${c.type} | Title/Name: "${c.title}"`);
  });
  Logger.log('---------------------------');
  Logger.log('👉 Copy your admin group ID (a negative number, e.g. -4xxxxxxxxx or -100xxxxxxxxxx) and save it as Script Property ADMIN_CHAT_ID.');
}

/**
 * Configures the Telegram webhook using the deployed web app API_URL and WEBHOOK_SECRET.
 */
function setWebhook() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('API_URL');
  const secret = props.getProperty('WEBHOOK_SECRET');

  if (!apiUrl) {
    Logger.log('❌ Missing API_URL Script Property. Deploy as Web App first and save the /exec URL in Script Properties.');
    return;
  }
  if (!secret) {
    Logger.log('❌ Missing WEBHOOK_SECRET Script Property. Run generateWebhookSecret() first.');
    return;
  }

  const webhookUrl = `${apiUrl}?key=${secret}`;
  Logger.log(`Setting webhook to: ${apiUrl}?key=***`);

  const res = callTelegramApi('setWebhook', {
    url: webhookUrl,
    allowed_updates: ['message'],
    drop_pending_updates: true
  });

  Logger.log('setWebhook response: ' + JSON.stringify(res));
  if (res.ok) {
    Logger.log('✅ Webhook successfully configured with Telegram.');
    logEvent('INFO', 'Setup', 'Configured Telegram webhook');
  } else {
    Logger.log(`❌ Failed to set webhook: ${res.description}`);
  }
}

/**
 * Removes the Telegram webhook.
 */
function deleteWebhook() {
  Logger.log('Calling deleteWebhook...');
  const res = callTelegramApi('deleteWebhook', { drop_pending_updates: true });
  Logger.log('deleteWebhook response: ' + JSON.stringify(res));
  if (res.ok) {
    Logger.log('✅ Webhook successfully deleted.');
    logEvent('INFO', 'Setup', 'Deleted Telegram webhook');
  } else {
    Logger.log(`❌ Failed to delete webhook: ${res.description}`);
  }
}

/**
 * Retrieves current webhook status from Telegram.
 * Logs a note if HTTP 302 appears in last_error_message (expected behavior in Apps Script redirects).
 */
function getWebhookInfo() {
  Logger.log('Calling getWebhookInfo...');
  const res = callTelegramApi('getWebhookInfo', {});
  Logger.log('getWebhookInfo response: ' + JSON.stringify(res));

  if (res.ok && res.result) {
    const info = res.result;
    Logger.log(`• Webhook URL: ${info.url ? info.url.replace(/key=[^&]+/, 'key=***') : '(none)'}`);
    Logger.log(`• Custom certificate: ${info.has_custom_certificate}`);
    Logger.log(`• Pending update count: ${info.pending_update_count}`);
    if (info.last_error_date) {
      Logger.log(`• Last error date: ${new Date(info.last_error_date * 1000).toISOString()}`);
    }
    if (info.last_error_message) {
      Logger.log(`• Last error message: ${info.last_error_message}`);
      if (info.last_error_message.includes('302')) {
        Logger.log('ℹ️ Note on 302 error: Expected with Apps Script: the script still runs; duplicates are ignored by update_id dedupe.');
      }
    }
  } else {
    Logger.log(`❌ Failed to get webhook info: ${res.description}`);
  }
}

/**
 * Sets bot commands, menu button, and descriptions via Telegram Bot API.
 */
function setupBotProfile() {
  const props = PropertiesService.getScriptProperties();
  const webappUrl = props.getProperty('WEBAPP_URL');

  if (!webappUrl) {
    Logger.log('❌ Missing WEBAPP_URL Script Property. Deploy frontend to GitHub Pages first and save the URL in Script Properties.');
    return;
  }

  Logger.log('1. Setting commands (/start)...');
  const cmdRes = callTelegramApi('setMyCommands', {
    commands: [
      { command: 'start', description: 'Open KIT Admissions' }
    ]
  });
  Logger.log('setMyCommands result: ' + JSON.stringify(cmdRes));

  Logger.log('2. Setting chat menu button (Admissions Web App)...');
  const menuRes = callTelegramApi('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Admissions',
      web_app: { url: webappUrl }
    }
  });
  Logger.log('setChatMenuButton result: ' + JSON.stringify(menuRes));

  Logger.log('3. Setting bot description...');
  const descRes = callTelegramApi('setMyDescription', {
    description: 'Welcome to Kirirom Institute of Technology (KIT) Admissions bot. Register your interest and estimate your Year-1 tuition fee and scholarship based on your BAC II grade.'
  });
  Logger.log('setMyDescription result: ' + JSON.stringify(descRes));

  Logger.log('4. Setting bot short description...');
  const shortDescRes = callTelegramApi('setMyShortDescription', {
    short_description: 'Official KIT admissions & Year-1 tuition scholarship estimator.'
  });
  Logger.log('setMyShortDescription result: ' + JSON.stringify(shortDescRes));

  if (cmdRes.ok && menuRes.ok && descRes.ok && shortDescRes.ok) {
    Logger.log('✅ Bot profile, commands, and menu button successfully configured.');
    logEvent('INFO', 'Setup', 'Configured Telegram bot profile');
  } else {
    Logger.log('⚠️ Some bot profile settings failed. Check logs above.');
  }
}

/**
 * Sends a test confirmation message to the admin chat using sendTelegramMessage.
 */
function sendTestMessage() {
  const props = PropertiesService.getScriptProperties();
  const adminChatId = props.getProperty('ADMIN_CHAT_ID');

  if (!adminChatId) {
    Logger.log('❌ Missing ADMIN_CHAT_ID Script Property.');
    return;
  }

  Logger.log(`Sending test message to admin chat: ${adminChatId}...`);
  const success = sendTelegramMessage(adminChatId, '✅ KIT Admissions bot connected');
  if (success) {
    Logger.log('✅ Test message sent successfully.');
  } else {
    Logger.log('❌ Failed to send test message. Check BOT_TOKEN and ADMIN_CHAT_ID.');
  }
}

/**
 * Validates the entire deployment:
 * 1. Checks all required Script Properties (masking BOT_TOKEN).
 * 2. Validates the Config tab by running readConfig().
 * 3. Runs the test suite via runSelfTests().
 * Prints a final summary: READY or NOT READY.
 */
function checkDeployment() {
  Logger.log('=== CHECKING DEPLOYMENT STATUS ===');
  const props = PropertiesService.getScriptProperties();
  let allPropsSet = true;

  Logger.log('[1/3] Checking Script Properties:');
  REQUIRED_SCRIPT_PROPERTIES.forEach(key => {
    const val = props.getProperty(key);
    if (!val) {
      Logger.log(`  ❌ ${key}: [MISSING]`);
      allPropsSet = false;
    } else if (key === 'BOT_TOKEN' || key === 'WEBHOOK_SECRET') {
      Logger.log(`  ✅ ${key}: [set]`);
    } else {
      Logger.log(`  ✅ ${key}: "${val}"`);
    }
  });

  Logger.log('[2/3] Checking Config tab:');
  let configValid = false;
  try {
    const cfg = readConfig();
    Logger.log(`  ✅ readConfig() passed. Loaded ${Object.keys(cfg.rates.partner).length} partner rates, ${Object.keys(cfg.rates.standard).length} standard rates, ${cfg.majors.Engineering.length + cfg.majors.Management.length} majors.`);
    configValid = true;
  } catch (err) {
    Logger.log(`  ❌ readConfig() failed: ${err.message}`);
  }

  Logger.log('[3/3] Running backend self-tests:');
  let testsPassed = false;
  try {
    const testResult = runSelfTests();
    if (testResult && testResult.failed === 0) {
      Logger.log(`  ✅ runSelfTests() passed: ${testResult.passed}/${testResult.total} tests passed.`);
      testsPassed = true;
    } else {
      Logger.log(`  ❌ runSelfTests() had failures: ${testResult ? testResult.failed : 'unknown'} failed.`);
    }
  } catch (err) {
    Logger.log(`  ❌ runSelfTests() threw error: ${err.message}`);
  }

  Logger.log('==================================');
  if (allPropsSet && configValid && testsPassed) {
    Logger.log('READY');
    return true;
  } else {
    Logger.log('NOT READY');
    return false;
  }
}
