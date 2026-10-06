/**
 * KIT Admissions Mini App - Automated Self-Tests
 * 
 * Verifies fee calculations, validation rules, initData verification,
 * and HTML escaping.
 * Does NOT write to the Leads sheet or send live Telegram messages.
 */

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

/**
 * Runs the complete Phase 2 self-test suite and logs detailed results.
 *
 * @return {{ total: number, passed: number, failed: number, results: Object[] }}
 */
function runSelfTests() {
  const results = [];
  let passed = 0;
  let failed = 0;

  function assert(testName, condition, detail) {
    if (condition) {
      passed++;
      results.push({ name: testName, status: 'PASS' });
      Logger.log(`[PASS] ${testName}`);
    } else {
      failed++;
      results.push({ name: testName, status: 'FAIL', detail: detail || '' });
      Logger.log(`[FAIL] ${testName} - ${detail || ''}`);
    }
  }

  Logger.log('====================================================');
  Logger.log('KIT Admissions Mini App - Starting Self-Test Suite');
  Logger.log('====================================================');

  const testConfig = {
    base_engineering: 5000,
    base_management: 4000,
    extra_offer: 10,
    admission_fee: 500,
    callback_hours: 24,
    rates: {
      partner: { A: 55, B: 40, C: 20, D: 10, E: 5 },
      standard: { A: 50, B: 30, C: 10, D: 5, E: 0 }
    },
    majors: {
      Engineering: ['Software Engineering', 'AI & Machine Learning', 'Cyber Security'],
      Management: ['Tourism DX & Hospitality Management', 'Business Administration with Applied AI']
    }
  };

  // --------------------------------------------------------------------------
  // 1. Fee Calculations (All 20 Combinations from PLAN.md Phase 5 Table)
  // --------------------------------------------------------------------------
  const feeExpected = [
    // Engineering ($5,000)
    { dept: 'Engineering', grade: 'A', partRate: 65, partYear: 1750, stdRate: 60, stdYear: 2000 },
    { dept: 'Engineering', grade: 'B', partRate: 50, partYear: 2500, stdRate: 40, stdYear: 3000 },
    { dept: 'Engineering', grade: 'C', partRate: 30, partYear: 3500, stdRate: 20, stdYear: 4000 },
    { dept: 'Engineering', grade: 'D', partRate: 20, partYear: 4000, stdRate: 15, stdYear: 4250 },
    { dept: 'Engineering', grade: 'E', partRate: 15, partYear: 4250, stdRate: 10, stdYear: 4500 },
    // Management ($4,000)
    { dept: 'Management', grade: 'A', partRate: 65, partYear: 1400, stdRate: 60, stdYear: 1600 },
    { dept: 'Management', grade: 'B', partRate: 50, partYear: 2000, stdRate: 40, stdYear: 2400 },
    { dept: 'Management', grade: 'C', partRate: 30, partYear: 2800, stdRate: 20, stdYear: 3200 },
    { dept: 'Management', grade: 'D', partRate: 20, partYear: 3200, stdRate: 15, stdYear: 3400 },
    { dept: 'Management', grade: 'E', partRate: 15, partYear: 3400, stdRate: 10, stdYear: 3600 }
  ];

  feeExpected.forEach(item => {
    const fees = calculateFees(item.dept, item.grade, testConfig);
    const testName = `Fee check: ${item.dept} Grade ${item.grade}`;
    const matches =
      fees.partner.finalRate === item.partRate &&
      fees.partner.yearly === item.partYear &&
      fees.standard.finalRate === item.stdRate &&
      fees.standard.yearly === item.stdYear;

    assert(
      testName,
      matches,
      `Expected Partner(${item.partRate}%, $${item.partYear}), Std(${item.stdRate}%, $${item.stdYear}). Got Partner(${fees.partner.finalRate}%, $${fees.partner.yearly}), Std(${fees.standard.finalRate}%, $${fees.standard.yearly})`
    );
  });

  // Quarter tuition check: Engineering A Partner = 437.5
  const engA = calculateFees('Engineering', 'A', testConfig);
  assert(
    'Quarter fee check: Engineering A Partner',
    engA.partner.quarter === 437.5,
    `Expected $437.5, got $${engA.partner.quarter}`
  );

  // --------------------------------------------------------------------------
  // 2. Validation Checks
  // --------------------------------------------------------------------------

  // Phone: letters cannot be valid
  assert('Validation: Phone "kk" rejected', !validatePhone('kk').valid);
  assert('Validation: Phone "abc123" rejected', !validatePhone('abc123').valid);

  // Phone: too short / invalid numbers
  assert('Validation: Phone "123" rejected', !validatePhone('123').valid);
  assert('Validation: Phone "168" rejected', !validatePhone('168').valid);
  assert('Validation: Phone "01234567" rejected (8 digits)', !validatePhone('01234567').valid);
  assert('Validation: Phone "0941234567" rejected (bad prefix 094)', !validatePhone('0941234567').valid);

  // Phone: valid numbers
  const p1 = validatePhone('012345678');
  assert('Validation: Phone "012345678" accepted', p1.valid && p1.normalized === '012345678');

  const p2 = validatePhone('0971234567');
  assert('Validation: Phone "0971234567" accepted', p2.valid && p2.normalized === '0971234567');

  const p3 = validatePhone('+855 12 345 678');
  assert('Validation: Phone "+855 12 345 678" normalized to 012345678', p3.valid && p3.normalized === '012345678');

  // Phone with +855 and leading 0: double zero collapsed
  const pDoubleZero = validatePhone('+855 012 345 678');
  assert('Validation: Phone "+855 012 345 678" collapsed to 012345678', pDoubleZero.valid && pDoubleZero.normalized === '012345678');
  assert('normalizePhoneNumber: "+855 012 345 678" -> "012345678"', normalizePhoneNumber('+855 012 345 678') === '012345678');

  // Phone format international
  assert('formatInternationalPhone: "012345678" -> "+85512345678"', formatInternationalPhone('012345678') === '+85512345678');

  // Base valid submission template
  const validSubmission = {
    name: 'Sok Dara',
    gender: 'Male',
    phone: '012345678',
    parentPhone: '016987654',
    email: 'sok.dara@gmail.com',
    province: 'Phnom Penh',
    highSchool: 'Bak Touk High School',
    department: 'Engineering',
    major: 'Software Engineering',
    grade: 'A',
    question: 'How do scholarship exams work?',
    consent: true
  };

  // Base valid submission passes
  const validRes = validateSubmission(validSubmission, testConfig);
  assert('Validation: Valid submission object accepted', validRes.valid, JSON.stringify(validRes.errors));

  // Parent phone equals student phone
  const samePhoneSub = Object.assign({}, validSubmission, { parentPhone: '012345678' });
  const samePhoneRes = validateSubmission(samePhoneSub, testConfig);
  assert('Validation: Parent phone equal to phone rejected', !samePhoneRes.valid && !!samePhoneRes.errors.parentPhone);

  // Email validations
  const emptyEmailRes = validateSubmission(Object.assign({}, validSubmission, { email: '' }), testConfig);
  assert('Validation: Empty email rejected', !emptyEmailRes.valid && !!emptyEmailRes.errors.email);

  const invalidEmail1 = validateSubmission(Object.assign({}, validSubmission, { email: 'abc' }), testConfig);
  assert('Validation: Email "abc" rejected', !invalidEmail1.valid && !!invalidEmail1.errors.email);

  const invalidEmail2 = validateSubmission(Object.assign({}, validSubmission, { email: 'abc@' }), testConfig);
  assert('Validation: Email "abc@" rejected', !invalidEmail2.valid && !!invalidEmail2.errors.email);

  const invalidEmail3 = validateSubmission(Object.assign({}, validSubmission, { email: 'abc@gmail' }), testConfig);
  assert('Validation: Email "abc@gmail" rejected', !invalidEmail3.valid && !!invalidEmail3.errors.email);

  // Formula injection in Name
  const formulaNameRes = validateSubmission(Object.assign({}, validSubmission, { name: '=HYPERLINK(1)' }), testConfig);
  assert('Validation: Name "=HYPERLINK(1)" rejected', !formulaNameRes.valid && !!formulaNameRes.errors.name);

  // Name with asterisks (should be rejected by name regex)
  const nameWithStar = validateSubmission(Object.assign({}, validSubmission, { name: 'Long_sophan*' }), testConfig);
  assert('Validation: Name "Long_sophan*" rejected by name regex', !nameWithStar.valid && !!nameWithStar.errors.name);

  // --------------------------------------------------------------------------
  // 3. initData Verification
  // --------------------------------------------------------------------------
  const fakeBotToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
  const testUser = { id: 88990011, username: 'testuser', first_name: 'Test' };
  const currentAuthDate = Math.floor(Date.now() / 1000);

  // Build valid signed initData
  const validInitData = buildTestInitData(fakeBotToken, testUser, currentAuthDate);
  const verifyValid = verifyInitData(validInitData, fakeBotToken);
  assert('verifyInitData: Valid initData accepted', verifyValid.valid && verifyValid.user.id === testUser.id);

  // Tampered query string (modified username without updating hash)
  const tamperedInitData = validInitData.replace('testuser', 'hackeruser');
  const verifyTampered = verifyInitData(tamperedInitData, fakeBotToken);
  assert('verifyInitData: Tampered field rejected', !verifyTampered.valid);

  // Expired auth_date (25 hours old)
  const expiredAuthDate = currentAuthDate - (25 * 3600);
  const expiredInitData = buildTestInitData(fakeBotToken, testUser, expiredAuthDate);
  const verifyExpired = verifyInitData(expiredInitData, fakeBotToken);
  assert('verifyInitData: Auth date 25h old rejected', !verifyExpired.valid);

  // Malformed initData (URL decode error) rejected without throwing
  let malformedThrew = false;
  let verifyMalformed = null;
  try {
    verifyMalformed = verifyInitData('user=%E0%A4%A&hash=00', fakeBotToken);
  } catch (e) {
    malformedThrew = true;
  }
  assert(
    'verifyInitData: Malformed URI "user=%E0%A4%A&hash=00" rejected without throwing',
    !malformedThrew && verifyMalformed && !verifyMalformed.valid
  );

  // --------------------------------------------------------------------------
  // 4. HTML Escaping
  // --------------------------------------------------------------------------
  const escapedOutput = escapeHtml('<b>Long_sophan*</b> & co');
  const expectedEscaped = '&lt;b&gt;Long_sophan*&lt;/b&gt; &amp; co';
  assert(
    'escapeHtml: "<b>Long_sophan*</b> & co" correctly escaped',
    escapedOutput === expectedEscaped,
    `Expected: "${expectedEscaped}", Got: "${escapedOutput}"`
  );

  // --------------------------------------------------------------------------
  // 5. Money Formatting
  // --------------------------------------------------------------------------
  assert('formatMoney: 1750 -> "$1,750"', formatMoney(1750) === '$1,750');
  assert('formatMoney: 437.5 -> "$437.50"', formatMoney(437.5) === '$437.50');
  assert('formatMoney: 500 -> "$500"', formatMoney(500) === '$500');

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  Logger.log('====================================================');
  Logger.log(`Self-Test Complete: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  Logger.log('====================================================');

  return {
    total: passed + failed,
    passed,
    failed,
    results
  };
}

/**
 * Test helper: constructs a signed initData query string for verification tests.
 * Uses shared computeTelegramInitDataHash with strict Byte[] method signatures.
 *
 * @param {string} botToken
 * @param {Object} userObj
 * @param {number} authDate
 * @return {string}
 */
function buildTestInitData(botToken, userObj, authDate) {
  const params = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(userObj)
  };

  const sortedKeys = Object.keys(params).sort();
  const dataCheckString = sortedKeys.map(k => `${k}=${params[k]}`).join('\n');
  const hash = computeTelegramInitDataHash(dataCheckString, botToken);

  return sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&') + `&hash=${hash}`;
}
