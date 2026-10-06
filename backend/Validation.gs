/**
 * KIT Admissions Mini App - Validation & Sanitization
 * 
 * Pure functions for validating user input and sanitizing values for display and sheets.
 * Contains no Google Sheets or external service dependencies.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Valid Cambodian mobile prefixes (3-digit strings starting with 0).
 */
const PHONE_PREFIXES = Object.freeze([
  '010', '011', '012', '013', '014', '015', '016', '017', '018',
  '031', '038',
  '060', '061', '066', '067', '068', '069',
  '070', '071', '076', '077', '078', '079',
  '080', '081', '083', '084', '085', '086', '087', '088', '089',
  '090', '092', '093', '095', '096', '097', '098', '099'
]);

/**
 * Exact list of 25 provinces in Cambodia.
 */
const PROVINCES = Object.freeze([
  'Banteay Meanchey',
  'Battambang',
  'Kampong Cham',
  'Kampong Chhnang',
  'Kampong Speu',
  'Kampong Thom',
  'Kampot',
  'Kandal',
  'Kep',
  'Koh Kong',
  'Kratie',
  'Mondulkiri',
  'Oddar Meanchey',
  'Pailin',
  'Phnom Penh',
  'Preah Sihanouk',
  'Preah Vihear',
  'Prey Veng',
  'Pursat',
  'Ratanakiri',
  'Siem Reap',
  'Stung Treng',
  'Svay Rieng',
  'Takeo',
  'Tbong Khmum'
]);

const GENDERS = Object.freeze(['Male', 'Female', 'Other']);
const DEPARTMENTS = Object.freeze(['Engineering', 'Management']);
const GRADES = Object.freeze(['A', 'B', 'C', 'D', 'E']);

// ============================================================================
// SANITIZATION HELPERS
// ============================================================================

/**
 * Strips ASCII and Unicode control characters from text.
 * Preserves standard whitespace (space, tab, newline).
 *
 * @param {string} str
 * @return {string}
 */
function stripControlChars(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

/**
 * Protects Google Sheets against formula injection.
 * If a text string starts with =, +, -, or @, prefixes it with a single quote.
 *
 * @param {*} val
 * @return {*}
 */
function sanitizeForSheet(val) {
  if (typeof val !== 'string') return val;
  if (/^[=+\-@]/.test(val)) {
    return "'" + val;
  }
  return val;
}

/**
 * Escapes HTML special characters (&, <, >, ", ') for safe Telegram HTML parse mode.
 * Leaves asterisks and underscores unescaped for formatting readability.
 *
 * @param {string} str
 * @return {string}
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes Cambodian phone numbers to local format (e.g., 012345678).
 * Strips spaces, dashes, dots, parentheses, converts +855 or 855 to leading 0,
 * and collapses double leading zeroes.
 *
 * @param {string} rawPhone
 * @return {string}
 */
function normalizePhoneNumber(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return '';
  let cleaned = stripControlChars(rawPhone).replace(/[\s\-\.\(\)]/g, '');
  if (cleaned.startsWith('+855')) {
    cleaned = '0' + cleaned.substring(4);
  } else if (cleaned.startsWith('855')) {
    cleaned = '0' + cleaned.substring(3);
  }
  cleaned = cleaned.replace(/^0+/, '0');
  return cleaned;
}

/**
 * Converts a normalized Cambodian phone number (0XXXXXXXX) to international format (+855XXXXXXXX).
 *
 * @param {string} phone Local phone starting with 0
 * @return {string}
 */
function formatInternationalPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (trimmed.startsWith('0')) {
    return '+855' + trimmed.substring(1);
  }
  if (trimmed.startsWith('+855')) {
    return trimmed;
  }
  return '+855' + trimmed;
}

/**
 * Converts a byte array to a lowercase hex string.
 *
 * @param {number[]} bytes
 * @return {string}
 */
function bytesToHex(bytes) {
  return bytes.map(b => {
    const byte = (b < 0 ? b + 256 : b).toString(16);
    return byte.length === 1 ? '0' + byte : byte;
  }).join('');
}

/**
 * Constant-time string comparison to mitigate timing attacks.
 *
 * @param {string} a
 * @param {string} b
 * @return {boolean}
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Shared helper to compute the HMAC-SHA256 signature for Telegram WebApp initData.
 * Step 1: secret_key = HMAC_SHA256(value=botToken, key="WebAppData") -> Byte[]
 * Step 2: signature = HMAC_SHA256(value=newBlob(dataCheckString).getBytes(), key=secret_key) -> Byte[]
 * Both arguments in step 2 are Byte[] to match strict Apps Script method signatures.
 *
 * @param {string} dataCheckString
 * @param {string} botToken
 * @return {string} Lowercase hex hash
 */
function computeTelegramInitDataHash(dataCheckString, botToken) {
  const secretKeyBytes = Utilities.computeHmacSha256Signature(botToken, 'WebAppData');
  const dataBytes = Utilities.newBlob(dataCheckString).getBytes();
  const signatureBytes = Utilities.computeHmacSha256Signature(dataBytes, secretKeyBytes);
  return bytesToHex(signatureBytes);
}

// ============================================================================
// VALIDATION LOGIC
// ============================================================================

/**
 * Validates a single Cambodian phone number against format and valid mobile prefixes.
 *
 * @param {string} rawPhone
 * @return {{ valid: boolean, normalized: string, error?: string }}
 */
function validatePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, normalized: '', error: 'Phone number is required' };
  }

  const normalized = normalizePhoneNumber(rawPhone);

  if (!/^\d+$/.test(normalized)) {
    return { valid: false, normalized, error: 'Phone number must contain digits only' };
  }

  if (!/^0\d{8,9}$/.test(normalized)) {
    return { valid: false, normalized, error: 'Enter a valid Cambodian phone number (9 or 10 digits)' };
  }

  const prefix = normalized.substring(0, 3);
  if (!PHONE_PREFIXES.includes(prefix)) {
    return { valid: false, normalized, error: `Invalid mobile network prefix (${prefix})` };
  }

  return { valid: true, normalized };
}

/**
 * Validates all fields for student lead submission.
 * Accepts only highSchool and question (no legacy aliases).
 *
 * @param {Object} data Raw submission object
 * @param {Object} config Typed config object from readConfig()
 * @return {{ valid: boolean, errors: Object<string, string>, clean: Object }}
 */
function validateSubmission(data, config) {
  const errors = {};
  const clean = {};

  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: { form: 'Invalid submission data' },
      clean: {}
    };
  }

  // 1. Name
  const rawName = stripControlChars(String(data.name || '')).trim().replace(/\s+/g, ' ');
  if (!rawName) {
    errors.name = 'Full name is required';
  } else if (rawName.length < 2 || rawName.length > 60) {
    errors.name = 'Name must be between 2 and 60 characters';
  } else if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(rawName)) {
    errors.name = 'Name can only contain letters, spaces, and valid punctuation';
  } else {
    clean.name = rawName;
  }

  // 2. Gender
  const rawGender = String(data.gender || '').trim();
  if (!GENDERS.includes(rawGender)) {
    errors.gender = 'Gender must be Male, Female, or Other';
  } else {
    clean.gender = rawGender;
  }

  // 3. Phone
  const phoneRes = validatePhone(String(data.phone || ''));
  if (!phoneRes.valid) {
    errors.phone = phoneRes.error;
  } else {
    clean.phone = phoneRes.normalized;
  }

  // 4. Parent Phone (optional)
  const rawParentPhone = data.parentPhone !== undefined && data.parentPhone !== null
    ? String(data.parentPhone).trim()
    : '';

  if (rawParentPhone) {
    const parentPhoneRes = validatePhone(rawParentPhone);
    if (!parentPhoneRes.valid) {
      errors.parentPhone = parentPhoneRes.error;
    } else if (clean.phone && parentPhoneRes.normalized === clean.phone) {
      errors.parentPhone = 'Parent phone must differ from student phone';
    } else {
      clean.parentPhone = parentPhoneRes.normalized;
    }
  } else {
    clean.parentPhone = '';
  }

  // 5. Email
  const rawEmail = stripControlChars(String(data.email || '')).trim().toLowerCase();
  if (!rawEmail) {
    errors.email = 'Email is required';
  } else if (rawEmail.length > 254) {
    errors.email = 'Email must not exceed 254 characters';
  } else if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(rawEmail)) {
    errors.email = 'Enter a valid email address';
  } else {
    clean.email = rawEmail;
  }

  // 6. Province
  const rawProvince = String(data.province || '').trim();
  if (!PROVINCES.includes(rawProvince)) {
    errors.province = 'Select a valid Cambodian province';
  } else {
    clean.province = rawProvince;
  }

  // 7. High School (only data.highSchool accepted)
  const rawHighSchool = stripControlChars(String(data.highSchool || '')).trim().replace(/\s+/g, ' ');
  if (!rawHighSchool) {
    errors.highSchool = 'High school name is required';
  } else if (rawHighSchool.length < 2 || rawHighSchool.length > 100) {
    errors.highSchool = 'High school must be between 2 and 100 characters';
  } else {
    clean.highSchool = rawHighSchool;
  }

  // 8. Department
  const rawDepartment = String(data.department || '').trim();
  if (!DEPARTMENTS.includes(rawDepartment)) {
    errors.department = 'Department must be Engineering or Management';
  } else {
    clean.department = rawDepartment;
  }

  // 9. Major
  const rawMajor = String(data.major || '').trim();
  if (!clean.department) {
    errors.major = 'Department must be selected first';
  } else {
    const validMajors = (config && config.majors && config.majors[clean.department]) || [];
    if (!validMajors.includes(rawMajor)) {
      errors.major = `Invalid major for ${clean.department}`;
    } else {
      clean.major = rawMajor;
    }
  }

  // 10. Grade
  const rawGrade = String(data.grade || '').trim().toUpperCase();
  if (!GRADES.includes(rawGrade)) {
    errors.grade = 'Grade must be A, B, C, D, or E';
  } else {
    clean.grade = rawGrade;
  }

  // 11. Question (optional, only data.question accepted)
  const rawQuestion = stripControlChars(String(data.question || '')).trim();
  if (rawQuestion.length > 500) {
    errors.question = 'Question cannot exceed 500 characters';
  } else {
    clean.question = rawQuestion;
  }

  // 12. Consent
  const rawConsent = data.consent;
  if (rawConsent !== true && rawConsent !== 'true') {
    errors.consent = 'You must agree to KIT admissions contact';
  } else {
    clean.consent = true;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    clean
  };
}
