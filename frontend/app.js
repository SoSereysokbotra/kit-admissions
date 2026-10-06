/**
 * KIT Admissions Mini App - Frontend Logic
 * 
 * Implements:
 * - Telegram WebApp integration (MainButton, BackButton, Haptics, Theme)
 * - Multi-step form flow (Welcome -> Step 1 -> Step 2 -> Step 3 -> Result)
 * - Offline / Preview mode with mock API (?preview=1)
 * - Form validation & non-blocking email typo hints
 * - LocalStorage draft persistence
 * - XSS-safe rendering (textContent & DOM nodes only)
 */

(function () {
  'use strict';

  // ==========================================================================
  // CONFIGURATION & STATE
  // ==========================================================================

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const urlParams = new URLSearchParams(window.location.search);
  const isPreview = urlParams.get('preview') === '1';
  const mockType = urlParams.get('mock') || '';

  const API_URL = (window.APP_CONFIG && window.APP_CONFIG.API_URL) ? window.APP_CONFIG.API_URL : '';
  const TIMEOUT_MS = 20000;
  const KIT_GREEN = '#005850';
  const DRAFT_STORAGE_KEY = 'kit_admissions_draft_v1';

  const state = {
    currentScreen: 'screen-loading',
    previousScreen: null,
    config: null,
    isSubmitting: false,
    formData: {
      name: '',
      gender: '',
      phone: '',
      parentPhone: '',
      email: '',
      province: '',
      highSchool: '',
      department: '',
      major: '',
      grade: '',
      question: '',
      consent: false
    },
    lastError: null
  };

  // ==========================================================================
  // DOM ELEMENT REFERENCES
  // ==========================================================================

  const dom = {
    appContainer: document.getElementById('app-container'),
    previewBadge: document.getElementById('preview-badge'),
    brandHeader: document.getElementById('brand-header'),
    progressContainer: document.getElementById('progress-container'),
    progressStepText: document.getElementById('progress-step-text'),
    progressFill: document.getElementById('progress-fill'),

    // Screens
    screenLoading: document.getElementById('screen-loading'),
    screenNoTelegram: document.getElementById('screen-no-telegram'),
    screenWelcome: document.getElementById('screen-welcome'),
    screenStep1: document.getElementById('screen-step-1'),
    screenStep2: document.getElementById('screen-step-2'),
    screenStep3: document.getElementById('screen-step-3'),
    screenResult: document.getElementById('screen-result'),
    screenError: document.getElementById('screen-error'),

    // In-page buttons (mirrors MainButton for preview and clients without MainButton)
    btnWelcomeStart: document.getElementById('btn-welcome-start'),
    btnStep1Next: document.getElementById('btn-step-1-next'),
    btnStep2Next: document.getElementById('btn-step-2-next'),
    btnStep3Submit: document.getElementById('btn-step-3-submit'),
    btnResultDone: document.getElementById('btn-result-done'),
    btnErrorAction: document.getElementById('btn-error-action'),

    // Edit links on Review screen
    btnEditStep1: document.getElementById('btn-edit-step-1'),
    btnEditStep2: document.getElementById('btn-edit-step-2'),

    // Inputs
    inputName: document.getElementById('input-name'),
    selectGender: document.getElementById('select-gender'),
    inputPhone: document.getElementById('input-phone'),
    inputParentPhone: document.getElementById('input-parent-phone'),
    inputEmail: document.getElementById('input-email'),
    selectProvince: document.getElementById('select-province'),
    inputHighSchool: document.getElementById('input-highschool'),
    selectDepartment: document.getElementById('select-department'),
    selectMajor: document.getElementById('select-major'),
    selectGrade: document.getElementById('select-grade'),
    inputQuestion: document.getElementById('input-question'),
    inputConsent: document.getElementById('input-consent'),
    charCount: document.getElementById('char-count'),
    typoHintEmail: document.getElementById('typo-hint-email'),

    // Error messages
    errorName: document.getElementById('error-name'),
    errorGender: document.getElementById('error-gender'),
    errorPhone: document.getElementById('error-phone'),
    errorParentPhone: document.getElementById('error-parentPhone'),
    errorEmail: document.getElementById('error-email'),
    errorProvince: document.getElementById('error-province'),
    errorHighSchool: document.getElementById('error-highSchool'),
    errorDepartment: document.getElementById('error-department'),
    errorMajor: document.getElementById('error-major'),
    errorGrade: document.getElementById('error-grade'),
    errorQuestion: document.getElementById('error-question'),
    errorConsent: document.getElementById('error-consent'),

    // Review Fields
    reviewName: document.getElementById('review-name'),
    reviewGender: document.getElementById('review-gender'),
    reviewPhone: document.getElementById('review-phone'),
    reviewParentPhoneRow: document.getElementById('review-parent-phone-row'),
    reviewParentPhone: document.getElementById('review-parent-phone'),
    reviewEmail: document.getElementById('review-email'),
    reviewProvince: document.getElementById('review-province'),
    reviewHighSchool: document.getElementById('review-highschool'),
    reviewDepartment: document.getElementById('review-department'),
    reviewMajor: document.getElementById('review-major'),
    reviewGrade: document.getElementById('review-grade'),
    reviewQuestionRow: document.getElementById('review-question-row'),
    reviewQuestion: document.getElementById('review-question'),

    // Result Fields
    resultTitle: document.getElementById('result-title'),
    resultSubtitle: document.getElementById('result-subtitle'),
    resPartnerRate: document.getElementById('res-partner-rate'),
    resStandardRate: document.getElementById('res-standard-rate'),
    resPartnerYearly: document.getElementById('res-partner-yearly'),
    resStandardYearly: document.getElementById('res-standard-yearly'),
    resPartnerSemester: document.getElementById('res-partner-semester'),
    resStandardSemester: document.getElementById('res-standard-semester'),
    resPartnerQuarter: document.getElementById('res-partner-quarter'),
    resStandardQuarter: document.getElementById('res-standard-quarter'),
    resAdmissionNote: document.getElementById('res-admission-note'),
    resCallbackNote: document.getElementById('res-callback-note'),
    resLeadRef: document.getElementById('res-lead-ref'),

    // Error Screen Details
    errorIcon: document.getElementById('error-icon'),
    errorTitle: document.getElementById('error-title'),
    errorMessage: document.getElementById('error-message')
  };

  // ==========================================================================
  // UTILITY & SANITIZATION HELPERS
  // ==========================================================================

  function formatMoney(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) return '$0';
    const isWhole = (amount % 1 === 0);
    const parts = isWhole ? amount.toFixed(0) : amount.toFixed(2);
    const [intPart, decPart] = parts.split('.');
    const formattedInt = Number(intPart).toLocaleString('en-US');
    return decPart ? `$${formattedInt}.${decPart}` : `$${formattedInt}`;
  }

  function normalizePhoneNumber(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return '';
    let cleaned = rawPhone.replace(/[\s\-\.\(\)]/g, '');
    if (cleaned.startsWith('+855')) {
      cleaned = '0' + cleaned.substring(4);
    } else if (cleaned.startsWith('855')) {
      cleaned = '0' + cleaned.substring(3);
    }
    cleaned = cleaned.replace(/^0+/, '0');
    return cleaned;
  }

  function formatPhoneForDisplay(phone) {
    const norm = normalizePhoneNumber(phone);
    if (!norm) return '';
    if (norm.length === 9) {
      return `${norm.substring(0, 3)} ${norm.substring(3, 6)} ${norm.substring(6)}`;
    }
    if (norm.length === 10) {
      return `${norm.substring(0, 3)} ${norm.substring(3, 6)} ${norm.substring(6)}`;
    }
    return norm;
  }

  function triggerHaptic(type) {
    if (tg && tg.HapticFeedback) {
      try {
        if (type === 'error' || type === 'success' || type === 'warning') {
          tg.HapticFeedback.notificationOccurred(type);
        } else if (type === 'impact') {
          tg.HapticFeedback.impactOccurred('medium');
        }
      } catch (e) {
        // Safe fallback
      }
    }
  }

  // ==========================================================================
  // DRAFT PERSISTENCE (localStorage)
  // ==========================================================================

  function saveDraft() {
    try {
      const draft = {
        name: state.formData.name,
        gender: state.formData.gender,
        phone: state.formData.phone,
        parentPhone: state.formData.parentPhone,
        email: state.formData.email,
        province: state.formData.province,
        highSchool: state.formData.highSchool,
        department: state.formData.department,
        major: state.formData.major,
        grade: state.formData.grade,
        question: state.formData.question
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch (e) {
      // Storage unavailable or disabled
    }

    // Enable closing confirmation if user entered anything
    const hasData = state.formData.name || state.formData.phone || state.formData.email;
    if (hasData && tg && tg.enableClosingConfirmation) {
      try {
        tg.enableClosingConfirmation();
      } catch (e) {}
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') return;

      Object.keys(draft).forEach(key => {
        if (key in state.formData && key !== 'consent') {
          state.formData[key] = draft[key] || '';
        }
      });
    } catch (e) {
      // Ignore corrupted draft
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {}
    if (tg && tg.disableClosingConfirmation) {
      try {
        tg.disableClosingConfirmation();
      } catch (e) {}
    }
  }

  // ==========================================================================
  // TELEGRAM INTEGRATION & BUTTON MIRRORING
  // ==========================================================================

  const hasNativeMainButton = Boolean(tg && tg.MainButton);

  const screenButtonMap = {
    'screen-welcome': dom.btnWelcomeStart,
    'screen-step-1': dom.btnStep1Next,
    'screen-step-2': dom.btnStep2Next,
    'screen-step-3': dom.btnStep3Submit,
    'screen-result': dom.btnResultDone,
    'screen-error': dom.btnErrorAction
  };

  function syncMainButton(text, isVisible, isProgress) {
    if (hasNativeMainButton) {
      try {
        if (isVisible) {
          tg.MainButton.setParams({ text: text, color: KIT_GREEN, text_color: '#ffffff' });
          if (isProgress) {
            tg.MainButton.showProgress();
          } else {
            tg.MainButton.hideProgress();
          }
          tg.MainButton.show();
        } else {
          tg.MainButton.hide();
        }
      } catch (e) {}
    }

    // Hide in-page primary buttons whenever we run inside real Telegram (initData present),
    // including ?preview=1 opened from the bot; a plain browser keeps the in-page buttons
    const isNativeActive = Boolean(hasNativeMainButton && tg.initData);
    const inPageButtons = [
      dom.btnWelcomeStart,
      dom.btnStep1Next,
      dom.btnStep2Next,
      dom.btnStep3Submit,
      dom.btnResultDone,
      dom.btnErrorAction
    ];

    inPageButtons.forEach(btn => {
      if (!btn) return;
      if (isNativeActive) {
        btn.classList.add('btn-hidden');
      } else {
        btn.classList.remove('btn-hidden');
      }
    });

    // Only the button of the CURRENT screen may show the progress state.
    const currentBtn = screenButtonMap[state.currentScreen];
    if (currentBtn) {
      if (isProgress) {
        currentBtn.disabled = true;
        currentBtn.textContent = 'Please wait...';
      } else {
        currentBtn.disabled = false;
        if (currentBtn.dataset.label) {
          currentBtn.textContent = currentBtn.dataset.label;
        }
      }
    }
  }

  function syncBackButton(isVisible) {
    if (tg && tg.BackButton) {
      try {
        if (isVisible) {
          tg.BackButton.show();
        } else {
          tg.BackButton.hide();
        }
      } catch (e) {}
    }
  }

  // ==========================================================================
  // NAVIGATION & SCREEN MANAGEMENT
  // ==========================================================================

  function showScreen(screenId) {
    state.previousScreen = state.currentScreen;
    state.currentScreen = screenId;

    const screens = [
      dom.screenLoading,
      dom.screenNoTelegram,
      dom.screenWelcome,
      dom.screenStep1,
      dom.screenStep2,
      dom.screenStep3,
      dom.screenResult,
      dom.screenError
    ];

    screens.forEach(s => {
      if (s) s.classList.remove('active');
    });

    const activeEl = document.getElementById(screenId);
    if (activeEl) {
      activeEl.classList.add('active');
    }

    const showBrand = ['screen-step-1', 'screen-step-2', 'screen-step-3', 'screen-result'].includes(screenId);
    dom.brandHeader.style.display = showBrand ? 'flex' : 'none';

    window.scrollTo(0, 0);

    // Update Progress Bar
    if (screenId === 'screen-step-1') {
      dom.progressContainer.style.display = 'block';
      dom.progressStepText.textContent = 'Step 1 of 3 · About you';
      dom.progressFill.style.width = '33%';
      syncBackButton(false);
      syncMainButton('Next', true, false);
    } else if (screenId === 'screen-step-2') {
      dom.progressContainer.style.display = 'block';
      dom.progressStepText.textContent = 'Step 2 of 3 · Your studies';
      dom.progressFill.style.width = '66%';
      syncBackButton(true);
      syncMainButton('Next', true, false);
    } else if (screenId === 'screen-step-3') {
      dom.progressContainer.style.display = 'block';
      dom.progressStepText.textContent = 'Step 3 of 3 · Review';
      dom.progressFill.style.width = '100%';
      syncBackButton(true);
      syncMainButton('Calculate Tuition', true, false);
      populateReviewScreen();
    } else if (screenId === 'screen-welcome') {
      dom.progressContainer.style.display = 'none';
      syncBackButton(false);
      syncMainButton('Get Started', true, false);
    } else if (screenId === 'screen-result') {
      dom.progressContainer.style.display = 'none';
      syncBackButton(false);
      syncMainButton('Done', true, false);
    } else if (screenId === 'screen-error') {
      dom.progressContainer.style.display = 'none';
      const isUnauth = state.lastError && state.lastError.code === 'UNAUTHORIZED';
      const isRateLimited = state.lastError && state.lastError.code === 'RATE_LIMITED';
      const isConfigError = !state.config;

      // Issue 6: If getConfig failed (state.config is null), BackButton must be hidden
      syncBackButton(!isConfigError);

      let btnText = 'Retry';
      if (isUnauth) {
        btnText = 'Close';
      } else if (isRateLimited) {
        btnText = 'Back';
      }
      dom.btnErrorAction.textContent = btnText;
      dom.btnErrorAction.dataset.label = btnText;
      syncMainButton(btnText, true, false);
    } else {
      dom.progressContainer.style.display = 'none';
      syncBackButton(false);
      syncMainButton('', false, false);
    }
  }

  function handleBackNavigation() {
    if (state.currentScreen === 'screen-step-2') {
      showScreen('screen-step-1');
    } else if (state.currentScreen === 'screen-step-3') {
      showScreen('screen-step-2');
    } else if (state.currentScreen === 'screen-step-1') {
      showScreen('screen-welcome');
    } else if (state.currentScreen === 'screen-error') {
      if (!state.config) {
        return;
      }
      if (state.previousScreen && state.previousScreen !== 'screen-loading') {
        showScreen(state.previousScreen);
      } else {
        showScreen('screen-welcome');
      }
    }
  }

  function handleMainAction() {
    if (state.currentScreen === 'screen-welcome') {
      showScreen('screen-step-1');
    } else if (state.currentScreen === 'screen-step-1') {
      if (validateStep1()) {
        showScreen('screen-step-2');
      } else {
        triggerHaptic('error');
      }
    } else if (state.currentScreen === 'screen-step-2') {
      if (validateStep2()) {
        showScreen('screen-step-3');
      } else {
        triggerHaptic('error');
      }
    } else if (state.currentScreen === 'screen-step-3') {
      if (validateStep3()) {
        submitForm();
      } else {
        triggerHaptic('error');
      }
    } else if (state.currentScreen === 'screen-result') {
      if (tg && tg.close) {
        tg.close();
      }
    } else if (state.currentScreen === 'screen-error') {
      if (state.lastError && state.lastError.code === 'UNAUTHORIZED') {
        if (tg && tg.close) tg.close();
      } else if (state.lastError && state.lastError.code === 'RATE_LIMITED') {
        // Issue 5: RATE_LIMITED error screen: main button says "Back" and returns to step 3 without resubmitting
        showScreen('screen-step-3');
      } else {
        // Retry
        if (!state.config) {
          fetchConfig();
        } else {
          submitForm();
        }
      }
    }
  }

  // ==========================================================================
  // VALIDATION & EMAIL TYPO DETECTION
  // ==========================================================================

  function clearError(fieldId, errorEl, inputEl) {
    if (errorEl) errorEl.textContent = '';
    if (inputEl) inputEl.removeAttribute('aria-invalid');
  }

  function setError(errorEl, inputEl, message) {
    if (errorEl) errorEl.textContent = message;
    if (inputEl) {
      inputEl.setAttribute('aria-invalid', 'true');
      inputEl.setAttribute('aria-describedby', errorEl ? errorEl.id : '');
    }
  }

  function checkEmailTypo(email) {
    if (!email || !email.includes('@')) {
      dom.typoHintEmail.style.display = 'none';
      dom.typoHintEmail.textContent = '';
      return;
    }

    const [user, domain] = email.split('@');
    if (!domain) return;

    const typoMap = {
      'gmial.com': 'gmail.com',
      'gmal.com': 'gmail.com',
      'gmail.co': 'gmail.com',
      'gmail.con': 'gmail.com',
      'yahoo.con': 'yahoo.com',
      'hotmial.com': 'hotmail.com'
    };

    let suggestionDomain = typoMap[domain.toLowerCase()] || null;

    if (!suggestionDomain) {
      if (domain.endsWith('.con')) {
        suggestionDomain = domain.slice(0, -4) + '.com';
      } else if (domain.endsWith('.cmo')) {
        suggestionDomain = domain.slice(0, -4) + '.com';
      }
    }

    if (suggestionDomain && suggestionDomain !== domain.toLowerCase()) {
      const suggestedEmail = `${user}@${suggestionDomain}`;
      dom.typoHintEmail.textContent = '';
      dom.typoHintEmail.style.display = 'block';

      const span = document.createElement('span');
      span.textContent = 'Did you mean ';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'typo-link';
      btn.textContent = suggestedEmail;
      btn.onclick = function () {
        dom.inputEmail.value = suggestedEmail;
        state.formData.email = suggestedEmail;
        dom.typoHintEmail.style.display = 'none';
        clearError('email', dom.errorEmail, dom.inputEmail);
        saveDraft();
      };
      dom.typoHintEmail.appendChild(span);
      dom.typoHintEmail.appendChild(btn);
      dom.typoHintEmail.appendChild(document.createTextNode('?'));
    } else {
      dom.typoHintEmail.style.display = 'none';
      dom.typoHintEmail.textContent = '';
    }
  }

  // Per-field validators for Step 1
  function validateName() {
    const nameVal = dom.inputName.value.trim().replace(/\s+/g, ' ');
    if (!nameVal) {
      setError(dom.errorName, dom.inputName, 'Full name is required');
      return false;
    }
    if (nameVal.length < 2 || nameVal.length > 60) {
      setError(dom.errorName, dom.inputName, 'Name must be between 2 and 60 characters');
      return false;
    }
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(nameVal)) {
      setError(dom.errorName, dom.inputName, 'Name can only contain letters, spaces, and valid punctuation');
      return false;
    }
    clearError('name', dom.errorName, dom.inputName);
    state.formData.name = nameVal;
    return true;
  }

  function validateGender() {
    const genderVal = dom.selectGender.value;
    if (!genderVal) {
      setError(dom.errorGender, dom.selectGender, 'Please select a gender');
      return false;
    }
    clearError('gender', dom.errorGender, dom.selectGender);
    state.formData.gender = genderVal;
    return true;
  }

  function validatePhone() {
    const phoneNorm = normalizePhoneNumber(dom.inputPhone.value);
    const prefixes = (state.config && state.config.phonePrefixes) || [];
    if (!phoneNorm) {
      setError(dom.errorPhone, dom.inputPhone, 'Phone number is required');
      return false;
    }
    if (!/^0\d{8,9}$/.test(phoneNorm)) {
      setError(dom.errorPhone, dom.inputPhone, 'Enter a valid Cambodian phone number (9 or 10 digits)');
      return false;
    }
    if (prefixes.length > 0 && !prefixes.includes(phoneNorm.substring(0, 3))) {
      setError(dom.errorPhone, dom.inputPhone, `Invalid network prefix (${phoneNorm.substring(0, 3)})`);
      return false;
    }
    clearError('phone', dom.errorPhone, dom.inputPhone);
    state.formData.phone = phoneNorm;
    return true;
  }

  function validateParentPhone() {
    const parentVal = dom.inputParentPhone.value.trim();
    if (!parentVal) {
      clearError('parentPhone', dom.errorParentPhone, dom.inputParentPhone);
      state.formData.parentPhone = '';
      return true;
    }
    const parentNorm = normalizePhoneNumber(parentVal);
    const prefixes = (state.config && state.config.phonePrefixes) || [];
    if (!/^0\d{8,9}$/.test(parentNorm)) {
      setError(dom.errorParentPhone, dom.inputParentPhone, 'Enter a valid Cambodian phone number (9 or 10 digits)');
      return false;
    }
    if (prefixes.length > 0 && !prefixes.includes(parentNorm.substring(0, 3))) {
      setError(dom.errorParentPhone, dom.inputParentPhone, `Invalid network prefix (${parentNorm.substring(0, 3)})`);
      return false;
    }
    const studentPhoneNorm = normalizePhoneNumber(dom.inputPhone.value);
    if (studentPhoneNorm && parentNorm === studentPhoneNorm) {
      setError(dom.errorParentPhone, dom.inputParentPhone, 'Parent phone must differ from student phone');
      return false;
    }
    clearError('parentPhone', dom.errorParentPhone, dom.inputParentPhone);
    state.formData.parentPhone = parentNorm;
    return true;
  }

  function validateEmail() {
    const emailVal = dom.inputEmail.value.trim().toLowerCase();
    if (!emailVal) {
      setError(dom.errorEmail, dom.inputEmail, 'Email address is required');
      return false;
    }
    if (emailVal.length > 254) {
      setError(dom.errorEmail, dom.inputEmail, 'Email must not exceed 254 characters');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(emailVal)) {
      setError(dom.errorEmail, dom.inputEmail, 'Enter a valid email address (name@domain.com)');
      return false;
    }
    clearError('email', dom.errorEmail, dom.inputEmail);
    state.formData.email = emailVal;
    return true;
  }

  function validateStep1() {
    const vName = validateName();
    const vGender = validateGender();
    const vPhone = validatePhone();
    const vParent = validateParentPhone();
    const vEmail = validateEmail();

    saveDraft();
    return Boolean(vName && vGender && vPhone && vParent && vEmail);
  }

  // Per-field validators for Step 2
  function validateProvince() {
    const provVal = dom.selectProvince.value;
    if (!provVal) {
      setError(dom.errorProvince, dom.selectProvince, 'Please select a province');
      return false;
    }
    clearError('province', dom.errorProvince, dom.selectProvince);
    state.formData.province = provVal;
    return true;
  }

  function validateHighSchool() {
    const schoolVal = dom.inputHighSchool.value.trim().replace(/\s+/g, ' ');
    if (!schoolVal) {
      setError(dom.errorHighSchool, dom.inputHighSchool, 'High school name is required');
      return false;
    }
    if (schoolVal.length < 2 || schoolVal.length > 100) {
      setError(dom.errorHighSchool, dom.inputHighSchool, 'High school must be between 2 and 100 characters');
      return false;
    }
    clearError('highSchool', dom.errorHighSchool, dom.inputHighSchool);
    state.formData.highSchool = schoolVal;
    return true;
  }

  function validateDepartment() {
    const deptVal = dom.selectDepartment.value;
    if (!deptVal) {
      setError(dom.errorDepartment, dom.selectDepartment, 'Please select a department');
      return false;
    }
    clearError('department', dom.errorDepartment, dom.selectDepartment);
    state.formData.department = deptVal;
    return true;
  }

  function validateMajor() {
    const majorVal = dom.selectMajor.value;
    if (!majorVal) {
      setError(dom.errorMajor, dom.selectMajor, 'Please select a major');
      return false;
    }
    clearError('major', dom.errorMajor, dom.selectMajor);
    state.formData.major = majorVal;
    return true;
  }

  function validateGrade() {
    const gradeVal = dom.selectGrade.value;
    if (!gradeVal) {
      setError(dom.errorGrade, dom.selectGrade, 'Please select your BAC II grade');
      return false;
    }
    clearError('grade', dom.errorGrade, dom.selectGrade);
    state.formData.grade = gradeVal;
    return true;
  }

  function validateQuestion() {
    const questionVal = dom.inputQuestion.value.trim();
    if (questionVal.length > 500) {
      setError(dom.errorQuestion, dom.inputQuestion, 'Question cannot exceed 500 characters');
      return false;
    }
    clearError('question', dom.errorQuestion, dom.inputQuestion);
    state.formData.question = questionVal;
    return true;
  }

  function validateStep2() {
    const vProv = validateProvince();
    const vSchool = validateHighSchool();
    const vDept = validateDepartment();
    const vMajor = validateMajor();
    const vGrade = validateGrade();
    const vQuestion = validateQuestion();

    saveDraft();
    return Boolean(vProv && vSchool && vDept && vMajor && vGrade && vQuestion);
  }

  function validateStep3() {
    let isValid = true;
    if (!dom.inputConsent.checked) {
      setError(dom.errorConsent, dom.inputConsent, 'You must agree before calculating tuition');
      isValid = false;
    } else {
      clearError('consent', dom.errorConsent, dom.inputConsent);
      state.formData.consent = true;
    }
    return isValid;
  }

  // ==========================================================================
  // REVIEW & RESULT POPULATION (XSS-Safe, textContent Only)
  // ==========================================================================

  function populateReviewScreen() {
    dom.reviewName.textContent = state.formData.name;
    dom.reviewGender.textContent = state.formData.gender;
    dom.reviewPhone.textContent = formatPhoneForDisplay(state.formData.phone);

    if (state.formData.parentPhone) {
      dom.reviewParentPhoneRow.style.display = 'flex';
      dom.reviewParentPhone.textContent = formatPhoneForDisplay(state.formData.parentPhone);
    } else {
      dom.reviewParentPhoneRow.style.display = 'none';
    }

    dom.reviewEmail.textContent = state.formData.email;
    dom.reviewProvince.textContent = state.formData.province;
    dom.reviewHighSchool.textContent = state.formData.highSchool;
    dom.reviewDepartment.textContent = state.formData.department;
    dom.reviewMajor.textContent = state.formData.major;
    dom.reviewGrade.textContent = `Grade ${state.formData.grade}`;

    if (state.formData.question) {
      dom.reviewQuestionRow.style.display = 'flex';
      dom.reviewQuestion.textContent = state.formData.question;
    } else {
      dom.reviewQuestionRow.style.display = 'none';
    }
  }

  function populateResultScreen(resData) {
    const fees = resData.fees;
    const admissionFee = resData.admissionFee || 500;
    const callbackHours = resData.callbackHours || 24;

    dom.resultTitle.textContent = `${state.formData.major} · Grade ${state.formData.grade}`;
    dom.resultSubtitle.textContent = `Base tuition: ${formatMoney(fees.base)} / year`;

    dom.resPartnerRate.textContent = `${fees.partner.baseRate}% + ${fees.partner.extraOffer}% = ${fees.partner.finalRate}%`;
    dom.resStandardRate.textContent = `${fees.standard.baseRate}% + ${fees.standard.extraOffer}% = ${fees.standard.finalRate}%`;

    dom.resPartnerYearly.textContent = formatMoney(fees.partner.yearly);
    dom.resStandardYearly.textContent = formatMoney(fees.standard.yearly);

    dom.resPartnerSemester.textContent = formatMoney(fees.partner.semester);
    dom.resStandardSemester.textContent = formatMoney(fees.standard.semester);

    dom.resPartnerQuarter.textContent = formatMoney(fees.partner.quarter);
    dom.resStandardQuarter.textContent = formatMoney(fees.standard.quarter);

    dom.resAdmissionNote.textContent = `• One-time admission fee of ${formatMoney(admissionFee)} is not included.`;
    dom.resCallbackNote.textContent = `📞 A counselor may call you within ${callbackHours} hours.`;
    dom.resLeadRef.textContent = `Reference: ${resData.leadId || ''}`;
  }

  // ==========================================================================
  // API CLIENT & SUBMISSION
  // ==========================================================================

  function executeApiRequest(payload) {
    if (isPreview) {
      return executeMockApi(payload);
    }

    if (!API_URL) {
      return Promise.reject({
        code: 'CONFIG_ERROR',
        message: 'API URL is not configured. Please contact administration.'
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then(response => {
        clearTimeout(timeoutId);
        return response.json();
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          return Promise.reject({
            code: 'TIMEOUT',
            message: 'Request timed out after 20 seconds. Please check your internet connection and retry.'
          });
        }
        return Promise.reject({
          code: 'NETWORK_ERROR',
          message: 'Unable to reach the server. Please check your internet connection and retry.'
        });
      });
  }

  function executeMockApi(payload) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (payload.action === 'getConfig') {
          resolve({
            ok: true,
            data: {
              majors: {
                Engineering: ['Software Engineering', 'AI & Machine Learning', 'Cyber Security'],
                Management: ['Tourism DX & Hospitality Management', 'Business Administration with Applied AI']
              },
              baseTuition: {
                Engineering: 5000,
                Management: 4000
              },
              extraOffer: 10,
              admissionFee: 500,
              callbackHours: 24,
              rates: {
                partner: {
                  A: { baseRate: 55, extraOffer: 10, finalRate: 65 },
                  B: { baseRate: 40, extraOffer: 10, finalRate: 50 },
                  C: { baseRate: 20, extraOffer: 10, finalRate: 30 },
                  D: { baseRate: 10, extraOffer: 10, finalRate: 20 },
                  E: { baseRate: 5, extraOffer: 10, finalRate: 15 }
                },
                standard: {
                  A: { baseRate: 50, extraOffer: 10, finalRate: 60 },
                  B: { baseRate: 30, extraOffer: 10, finalRate: 40 },
                  C: { baseRate: 10, extraOffer: 10, finalRate: 20 },
                  D: { baseRate: 5, extraOffer: 10, finalRate: 15 },
                  E: { baseRate: 0, extraOffer: 10, finalRate: 10 }
                }
              },
              provinces: [
                'Banteay Meanchey', 'Battambang', 'Kampong Cham', 'Kampong Chhnang', 'Kampong Speu',
                'Kampong Thom', 'Kampot', 'Kandal', 'Kep', 'Koh Kong', 'Kratie', 'Mondulkiri',
                'Oddar Meanchey', 'Pailin', 'Phnom Penh', 'Preah Sihanouk', 'Preah Vihear',
                'Prey Veng', 'Pursat', 'Ratanakiri', 'Siem Reap', 'Stung Treng', 'Svay Rieng',
                'Takeo', 'Tbong Khmum'
              ],
              phonePrefixes: [
                '010', '011', '012', '013', '014', '015', '016', '017', '018',
                '031', '038', '060', '061', '066', '067', '068', '069', '070',
                '071', '076', '077', '078', '079', '080', '081', '083', '084',
                '085', '086', '087', '088', '089', '090', '092', '093', '095',
                '096', '097', '098', '099'
              ]
            }
          });
          return;
        }

        if (payload.action === 'submit') {
          if (mockType === 'validation') {
            resolve({
              ok: false,
              error: {
                code: 'VALIDATION',
                message: 'Validation failed',
                fields: { phone: 'Invalid phone number' }
              }
            });
            return;
          }
          if (mockType === 'ratelimit') {
            resolve({
              ok: false,
              error: {
                code: 'RATE_LIMITED',
                message: 'Too many submissions. Please wait 10 minutes.'
              }
            });
            return;
          }
          if (mockType === 'network') {
            reject({
              code: 'NETWORK_ERROR',
              message: 'Mock network connection failure. Retry to simulate recovery.'
            });
            return;
          }

          // Normal mock calculation matching PLAN.md
          const base = payload.department === 'Engineering' ? 5000 : 4000;
          const partnerMap = { A: 65, B: 50, C: 30, D: 20, E: 15 };
          const standardMap = { A: 60, B: 40, C: 20, D: 15, E: 10 };
          const pFinal = partnerMap[payload.grade] || 15;
          const sFinal = standardMap[payload.grade] || 10;
          const pYear = Math.round(base * (1 - pFinal / 100) * 100) / 100;
          const sYear = Math.round(base * (1 - sFinal / 100) * 100) / 100;

          resolve({
            ok: true,
            data: {
              leadId: 'KIT-PREVIEW-0001',
              fees: {
                base: base,
                partner: {
                  baseRate: pFinal - 10,
                  extraOffer: 10,
                  finalRate: pFinal,
                  yearly: pYear,
                  semester: Math.round((pYear / 2) * 100) / 100,
                  quarter: Math.round((pYear / 4) * 100) / 100
                },
                standard: {
                  baseRate: sFinal - 10,
                  extraOffer: 10,
                  finalRate: sFinal,
                  yearly: sYear,
                  semester: Math.round((sYear / 2) * 100) / 100,
                  quarter: Math.round((sYear / 4) * 100) / 100
                }
              },
              callbackHours: 24,
              admissionFee: 500
            }
          });
        }
      }, 350);
    });
  }

  function fetchConfig() {
    showScreen('screen-loading');

    executeApiRequest({ action: 'getConfig' })
      .then(res => {
        if (!res || !res.ok) {
          throw (res && res.error) || { code: 'SERVER_ERROR', message: 'Failed to load configuration' };
        }
        state.config = res.data;
        populateConfigDropdowns();
        showScreen('screen-welcome');
      })
      .catch(err => {
        state.lastError = err;
        displayErrorScreen(err);
      });
  }

  function populateConfigDropdowns() {
    if (!state.config) return;

    // 1. Populate Provinces
    dom.selectProvince.innerHTML = '';
    const defProv = document.createElement('option');
    defProv.value = '';
    defProv.textContent = 'Select province';
    dom.selectProvince.appendChild(defProv);

    (state.config.provinces || []).forEach(prov => {
      const opt = document.createElement('option');
      opt.value = prov;
      opt.textContent = prov;
      dom.selectProvince.appendChild(opt);
    });

    if (state.formData.province) {
      dom.selectProvince.value = state.formData.province;
    }

    // 2. Set Department & Major options
    if (state.formData.department) {
      dom.selectDepartment.value = state.formData.department;
      updateMajorDropdown(state.formData.department);
      if (state.formData.major) {
        dom.selectMajor.value = state.formData.major;
      }
    }
  }

  function updateMajorDropdown(dept) {
    dom.selectMajor.innerHTML = '';
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = dept ? 'Select major' : 'Select department first';
    dom.selectMajor.appendChild(defOpt);

    if (!dept || !state.config || !state.config.majors || !state.config.majors[dept]) {
      dom.selectMajor.disabled = true;
      return;
    }

    dom.selectMajor.disabled = false;
    state.config.majors[dept].forEach(maj => {
      const opt = document.createElement('option');
      opt.value = maj;
      opt.textContent = maj;
      dom.selectMajor.appendChild(opt);
    });
  }

  function submitForm() {
    if (state.isSubmitting) return;
    state.isSubmitting = true;
    syncMainButton('Submitting...', true, true);

    const initData = (tg && tg.initData) ? tg.initData : (isPreview ? 'query_id=preview&user=%7B%22id%22%3A12345%7D&auth_date=1700000000&hash=mock' : '');

    const payload = {
      action: 'submit',
      initData: initData,
      name: state.formData.name,
      gender: state.formData.gender,
      phone: state.formData.phone,
      parentPhone: state.formData.parentPhone || '',
      email: state.formData.email,
      province: state.formData.province,
      highSchool: state.formData.highSchool,
      department: state.formData.department,
      major: state.formData.major,
      grade: state.formData.grade,
      question: state.formData.question || '',
      consent: true
    };

    executeApiRequest(payload)
      .then(res => {
        state.isSubmitting = false;
        if (dom.btnStep3Submit && dom.btnStep3Submit.dataset.label) {
          dom.btnStep3Submit.textContent = dom.btnStep3Submit.dataset.label;
          dom.btnStep3Submit.disabled = false;
        }
        if (!res || !res.ok) {
          handleSubmissionFailure((res && res.error) || { code: 'SERVER_ERROR', message: 'Submission failed' });
          return;
        }

        clearDraft();
        triggerHaptic('success');
        populateResultScreen(res.data);
        showScreen('screen-result');
      })
      .catch(err => {
        state.isSubmitting = false;
        if (dom.btnStep3Submit && dom.btnStep3Submit.dataset.label) {
          dom.btnStep3Submit.textContent = dom.btnStep3Submit.dataset.label;
          dom.btnStep3Submit.disabled = false;
        }
        handleSubmissionFailure(err);
      });
  }

  function handleSubmissionFailure(err) {
    triggerHaptic('error');

    if (err.code === 'VALIDATION' && err.fields) {
      // Map server validation errors back to fields and navigate to first error
      const fieldMap = {
        name: { el: dom.errorName, input: dom.inputName, step: 'screen-step-1' },
        gender: { el: dom.errorGender, input: dom.selectGender, step: 'screen-step-1' },
        phone: { el: dom.errorPhone, input: dom.inputPhone, step: 'screen-step-1' },
        parentPhone: { el: dom.errorParentPhone, input: dom.inputParentPhone, step: 'screen-step-1' },
        email: { el: dom.errorEmail, input: dom.inputEmail, step: 'screen-step-1' },
        province: { el: dom.errorProvince, input: dom.selectProvince, step: 'screen-step-2' },
        highSchool: { el: dom.errorHighSchool, input: dom.inputHighSchool, step: 'screen-step-2' },
        department: { el: dom.errorDepartment, input: dom.selectDepartment, step: 'screen-step-2' },
        major: { el: dom.errorMajor, input: dom.selectMajor, step: 'screen-step-2' },
        grade: { el: dom.errorGrade, input: dom.selectGrade, step: 'screen-step-2' },
        question: { el: dom.errorQuestion, input: dom.inputQuestion, step: 'screen-step-2' },
        consent: { el: dom.errorConsent, input: dom.inputConsent, step: 'screen-step-3' }
      };

      let firstStep = null;
      Object.keys(err.fields).forEach(key => {
        if (fieldMap[key]) {
          setError(fieldMap[key].el, fieldMap[key].input, err.fields[key]);
          if (!firstStep) {
            firstStep = fieldMap[key].step;
          }
        }
      });

      if (firstStep) {
        showScreen(firstStep);
      }
      return;
    }

    state.lastError = err;
    displayErrorScreen(err);
  }

  function displayErrorScreen(err) {
    state.lastError = err;
    dom.errorTitle.textContent = 'Unable to complete request';
    dom.errorMessage.textContent = err.message || 'An unexpected error occurred. Please try again.';

    if (err.code === 'UNAUTHORIZED') {
      dom.errorTitle.textContent = 'Session Expired';
      dom.errorMessage.textContent = 'Your Telegram session is invalid or expired. Please close and re-open the app from the bot.';
      const actionText = 'Close';
      dom.btnErrorAction.textContent = actionText;
      dom.btnErrorAction.dataset.label = actionText;
    } else if (err.code === 'RATE_LIMITED') {
      dom.errorTitle.textContent = 'Too Many Submissions';
      dom.errorMessage.textContent = err.message || 'Too many submissions. Please wait 10 minutes.';
      const actionText = 'Back';
      dom.btnErrorAction.textContent = actionText;
      dom.btnErrorAction.dataset.label = actionText;
    } else {
      const actionText = 'Retry';
      dom.btnErrorAction.textContent = actionText;
      dom.btnErrorAction.dataset.label = actionText;
    }

    showScreen('screen-error');
  }

  // ==========================================================================
  // EVENT LISTENERS & INPUT CONTROLS
  // ==========================================================================

  function bindEvents() {
    // Buttons
    dom.btnWelcomeStart.addEventListener('click', handleMainAction);
    dom.btnStep1Next.addEventListener('click', handleMainAction);
    dom.btnStep2Next.addEventListener('click', handleMainAction);
    dom.btnStep3Submit.addEventListener('click', handleMainAction);
    dom.btnResultDone.addEventListener('click', handleMainAction);
    dom.btnErrorAction.addEventListener('click', handleMainAction);

    // Telegram MainButton & BackButton
    if (tg && tg.MainButton) {
      tg.MainButton.onClick(handleMainAction);
    }
    if (tg && tg.BackButton) {
      tg.BackButton.onClick(handleBackNavigation);
    }

    // Edit links on Review step
    dom.btnEditStep1.addEventListener('click', () => showScreen('screen-step-1'));
    dom.btnEditStep2.addEventListener('click', () => showScreen('screen-step-2'));

    // Input handlers with instant error clearing and per-field blur validation
    dom.inputName.addEventListener('input', () => {
      state.formData.name = dom.inputName.value;
      if (dom.inputName.value.trim().length >= 2) {
        clearError('name', dom.errorName, dom.inputName);
      }
      saveDraft();
    });
    dom.inputName.addEventListener('blur', () => {
      validateName();
      saveDraft();
    });

    dom.selectGender.addEventListener('change', () => {
      state.formData.gender = dom.selectGender.value;
      if (dom.selectGender.value) {
        clearError('gender', dom.errorGender, dom.selectGender);
      }
      saveDraft();
    });
    dom.selectGender.addEventListener('blur', () => {
      validateGender();
      saveDraft();
    });

    // Phone input restriction: digits and single leading +
    dom.inputPhone.addEventListener('input', () => {
      let val = dom.inputPhone.value.replace(/[^\d+]/g, '');
      if (val.includes('+')) {
        val = '+' + val.replace(/\+/g, '');
      }
      dom.inputPhone.value = val;
      state.formData.phone = normalizePhoneNumber(val);
      if (state.formData.phone.length >= 9) {
        clearError('phone', dom.errorPhone, dom.inputPhone);
      }
      saveDraft();
    });
    dom.inputPhone.addEventListener('blur', () => {
      if (dom.inputPhone.value.trim()) {
        dom.inputPhone.value = formatPhoneForDisplay(dom.inputPhone.value);
      }
      validatePhone();
      if (dom.inputParentPhone.value.trim()) {
        validateParentPhone();
      }
      saveDraft();
    });
    dom.inputPhone.addEventListener('focus', () => {
      dom.inputPhone.value = normalizePhoneNumber(dom.inputPhone.value);
    });

    // Parent Phone input restriction
    dom.inputParentPhone.addEventListener('input', () => {
      let val = dom.inputParentPhone.value.replace(/[^\d+]/g, '');
      if (val.includes('+')) {
        val = '+' + val.replace(/\+/g, '');
      }
      dom.inputParentPhone.value = val;
      state.formData.parentPhone = normalizePhoneNumber(val);
      clearError('parentPhone', dom.errorParentPhone, dom.inputParentPhone);
      saveDraft();
    });
    dom.inputParentPhone.addEventListener('blur', () => {
      if (dom.inputParentPhone.value.trim()) {
        dom.inputParentPhone.value = formatPhoneForDisplay(dom.inputParentPhone.value);
      }
      validateParentPhone();
      saveDraft();
    });
    dom.inputParentPhone.addEventListener('focus', () => {
      dom.inputParentPhone.value = normalizePhoneNumber(dom.inputParentPhone.value);
    });

    // Email
    dom.inputEmail.addEventListener('input', () => {
      state.formData.email = dom.inputEmail.value.trim().toLowerCase();
      checkEmailTypo(state.formData.email);
      if (state.formData.email.includes('@') && state.formData.email.includes('.')) {
        clearError('email', dom.errorEmail, dom.inputEmail);
      }
      saveDraft();
    });
    dom.inputEmail.addEventListener('blur', () => {
      validateEmail();
      saveDraft();
    });

    // Province
    dom.selectProvince.addEventListener('change', () => {
      state.formData.province = dom.selectProvince.value;
      if (dom.selectProvince.value) {
        clearError('province', dom.errorProvince, dom.selectProvince);
      }
      saveDraft();
    });
    dom.selectProvince.addEventListener('blur', () => {
      validateProvince();
      saveDraft();
    });

    // High School
    dom.inputHighSchool.addEventListener('input', () => {
      state.formData.highSchool = dom.inputHighSchool.value;
      if (dom.inputHighSchool.value.trim().length >= 2) {
        clearError('highSchool', dom.errorHighSchool, dom.inputHighSchool);
      }
      saveDraft();
    });
    dom.inputHighSchool.addEventListener('blur', () => {
      validateHighSchool();
      saveDraft();
    });

    // Department & Major
    dom.selectDepartment.addEventListener('change', () => {
      const dept = dom.selectDepartment.value;
      state.formData.department = dept;
      state.formData.major = '';
      updateMajorDropdown(dept);
      clearError('department', dom.errorDepartment, dom.selectDepartment);
      clearError('major', dom.errorMajor, dom.selectMajor);
      saveDraft();
    });
    dom.selectDepartment.addEventListener('blur', () => {
      validateDepartment();
      saveDraft();
    });

    dom.selectMajor.addEventListener('change', () => {
      state.formData.major = dom.selectMajor.value;
      if (dom.selectMajor.value) {
        clearError('major', dom.errorMajor, dom.selectMajor);
      }
      saveDraft();
    });
    dom.selectMajor.addEventListener('blur', () => {
      validateMajor();
      saveDraft();
    });

    // Grade
    dom.selectGrade.addEventListener('change', () => {
      state.formData.grade = dom.selectGrade.value;
      if (dom.selectGrade.value) {
        clearError('grade', dom.errorGrade, dom.selectGrade);
      }
      saveDraft();
    });
    dom.selectGrade.addEventListener('blur', () => {
      validateGrade();
      saveDraft();
    });

    // Question & Char counter
    dom.inputQuestion.addEventListener('input', () => {
      const len = dom.inputQuestion.value.length;
      dom.charCount.textContent = String(len);
      state.formData.question = dom.inputQuestion.value;
      saveDraft();
    });
    dom.inputQuestion.addEventListener('blur', () => {
      validateQuestion();
      saveDraft();
    });

    // Consent
    dom.inputConsent.addEventListener('change', () => {
      state.formData.consent = dom.inputConsent.checked;
      if (dom.inputConsent.checked) {
        clearError('consent', dom.errorConsent, dom.inputConsent);
      }
    });
  }

  function restoreDraftToInputs() {
    if (state.formData.name) dom.inputName.value = state.formData.name;
    if (state.formData.gender) dom.selectGender.value = state.formData.gender;
    if (state.formData.phone) dom.inputPhone.value = formatPhoneForDisplay(state.formData.phone);
    if (state.formData.parentPhone) dom.inputParentPhone.value = formatPhoneForDisplay(state.formData.parentPhone);
    if (state.formData.email) dom.inputEmail.value = state.formData.email;
    if (state.formData.highSchool) dom.inputHighSchool.value = state.formData.highSchool;
    if (state.formData.grade) dom.selectGrade.value = state.formData.grade;
    if (state.formData.question) {
      dom.inputQuestion.value = state.formData.question;
      dom.charCount.textContent = String(state.formData.question.length);
    }
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  function init() {
    // Store initial labels for all in-page primary buttons
    const inPageButtons = [
      dom.btnWelcomeStart,
      dom.btnStep1Next,
      dom.btnStep2Next,
      dom.btnStep3Submit,
      dom.btnResultDone,
      dom.btnErrorAction
    ];
    inPageButtons.forEach(btn => {
      if (btn && !btn.dataset.label) {
        btn.dataset.label = btn.textContent.trim();
      }
    });

    bindEvents();
    loadDraft();
    restoreDraftToInputs();

    if (tg) {
      try {
        tg.ready();
        tg.expand();
      } catch (e) {}
    }

    if (isPreview) {
      dom.previewBadge.style.display = 'block';
      fetchConfig();
      return;
    }

    // Verify Telegram context
    const hasInitData = Boolean(tg && tg.initData && tg.initData.length > 0);
    if (!hasInitData) {
      showScreen('screen-no-telegram');
      return;
    }

    fetchConfig();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
