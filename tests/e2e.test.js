// End-to-end: REAL frontend (Telegram mode, MainButton) -> REAL backend code on mock Google services.
const puppeteer = require('puppeteer-core'), crypto = require('crypto');
const TOKEN = process.env.TEST_TOKEN || '7000000000:AAFakeTokenForE2ETestingOnly_xyz123', API = 'http://127.0.0.1:8766/';
const results = []; const ok = (n, c, d = '') => results.push([c ? 'PASS' : 'FAIL', n, c ? '' : d]);

function initData(user, authDate = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ query_id: 'AAQ1', user: JSON.stringify(user), auth_date: String(authDate), signature: 'sig' });
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.append('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}
const tgStub = init => `window.Telegram={WebApp:(function(){
  const mk=()=>({text:'',isVisible:false,h:[],setText(t){this.text=t},setParams(o){if(o.text!==undefined)this.text=o.text;if(o.color)this.color=o.color},show(){this.isVisible=true},hide(){this.isVisible=false},
    showProgress(){this.progress=true},hideProgress(){this.progress=false},onClick(f){this.h.push(f)},click(){this.h.forEach(f=>f())}});
  return {initData:${JSON.stringify(init)},initDataUnsafe:{},version:'8.0',MainButton:mk(),BackButton:mk(),
    HapticFeedback:{notificationOccurred(t){(window.__hap=window.__hap||[]).push(t)},impactOccurred(){}},
    ready(){},expand(){},close(){window.__closed=true},
    enableClosingConfirmation(){window.__cc=true},disableClosingConfirmation(){window.__cc=false}};})()};`;
const post = async (body, q = '') => {
  const t = await (await fetch(API + q, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) })).text();
  try { return JSON.parse(t); } catch (e) { return { raw: t }; }
};
const state = async () => (await fetch(API + '__state')).json();

async function open(b, init) {
  const p = await b.newPage(); await p.setViewport({ width: 360, height: 740 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', r => {
    const u = r.url();
    if (u.includes('telegram-web-app.js')) return r.respond({ contentType: 'application/javascript', body: tgStub(init) });
    if (new URL(u).pathname.endsWith('/config.js')) return r.respond({ contentType: 'application/javascript', body: `window.APP_CONFIG={API_URL:${JSON.stringify(API)}};` });
    r.continue();
  });
  await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle2' });
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 500)); p.errs = errs; return p;
}
const main = async p => { await p.evaluate(() => Telegram.WebApp.MainButton.click()); await new Promise(r => setTimeout(r, 500)); };
const active = p => p.evaluate(() => document.querySelector('.screen.active').id);
async function fill(p, o = {}) {
  await main(p);
  await p.type('#input-name', o.name || 'Sok Dara'); await p.select('#select-gender', 'Female');
  await p.type('#input-phone', o.phone || '+855 012 345 678'); await p.type('#input-email', 'sok.dara@gmail.com'); await main(p);
  await p.select('#select-province', 'Siem Reap'); await p.type('#input-highschool', 'Hun Sen Siem Reap High School');
  await p.select('#select-department', o.dept || 'Engineering'); await p.select('#select-major', o.major || 'Cyber Security');
  await p.select('#select-grade', o.grade || 'A');
  await p.type('#input-question', o.q === undefined ? '<b>Dorm</b> & bus?' : o.q); await main(p);
  await p.click('#input-consent'); await main(p); await new Promise(r => setTimeout(r, 800));
}

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const user = { id: 555001, first_name: 'Dara', username: 'sok_dara' };

  // 1. Happy path through the Telegram-mode UI
  let p = await open(b, initData(user));
  ok('Telegram mode: in-page buttons hidden', await p.evaluate(() => [...document.querySelectorAll('.btn-primary')].every(x => !x.offsetParent)));
  ok('MainButton shows "Get Started" on welcome', await p.evaluate(() => Telegram.WebApp.MainButton.text === 'Get Started' && Telegram.WebApp.MainButton.isVisible));
  ok('MainButton uses KIT green', await p.evaluate(() => Telegram.WebApp.MainButton.color === '#005850'));
  ok('Provinces loaded from server (25)', (await p.$$eval('#select-province option', o => o.length - 1)) === 25);
  await fill(p);
  ok('Result screen shown', (await active(p)) === 'screen-result', await active(p));
  const cells = await p.evaluate(() => [...document.querySelectorAll('.result-table td')].map(t => t.textContent).join('|'));
  ok('Result values Eng A', cells === 'Scholarship|55% + 10% = 65%|50% + 10% = 60%|Pay yearly|$1,750|$2,000|Pay per semester|$875|$1,000|Pay per quarter|$437.50|$500', cells);
  ok('Lead reference shown', /Reference: KIT-\d{6}-0001/.test(await p.$eval('#res-lead-ref', e => e.textContent)));
  ok('MainButton "Done", BackButton hidden', await p.evaluate(() => Telegram.WebApp.MainButton.text === 'Done' && !Telegram.WebApp.BackButton.isVisible));
  ok('Success haptic + closing confirmation off', await p.evaluate(() => (window.__hap || []).includes('success') && window.__cc === false));
  await main(p); ok('Done closes app', await p.evaluate(() => window.__closed === true));
  ok('No page errors', p.errs.length === 0, p.errs.join(';'));

  let s = await state(); const H = s.headers, row = s.leads[1], col = n => row[H.indexOf(n)];
  ok('Row written to Leads', !!row);
  ok('Phone stored as text with leading 0', col('Phone') === '012345678', col('Phone'));
  ok('Timestamp is a real Date', typeof col('Timestamp') === 'string' && !isNaN(Date.parse(col('Timestamp'))), String(col('Timestamp')));
  ok('Status New / Duplicate No', col('Status') === 'New' && col('Duplicate') === 'No');
  ok('Final rates + fees stored', col('Partner %') === 65 && col('Standard %') === 60 && col('Partner Fee / Year') === 1750 && col('Standard Fee / Year') === 2000);
  ok('Telegram ID taken from verified initData', col('Telegram ID') === '555001' && col('Telegram Username') === 'sok_dara');
  ok('Question with "<b>" stored as plain text', col('Question') === '<b>Dorm</b> & bus?');
  const admin = s.sent.find(m => m.body.chat_id === '-4000000001'), stud = s.sent.find(m => m.body.chat_id === 555001);
  ok('Admin alert sent (HTML mode)', admin && admin.body.parse_mode === 'HTML');
  ok('Admin alert escapes user HTML', admin && admin.body.text.includes('&lt;b&gt;Dorm&lt;/b&gt; &amp; bus?') && !admin.body.text.includes('<b>Dorm'));
  ok('Admin alert: +855 phone, no tel: link', admin && admin.body.text.includes('+85512345678') && !admin.body.text.includes('tel:'));
  ok('Student message: 24 hours + $500', stud && stud.body.text.includes('within 24 hours') && stud.body.text.includes('$500'));

  // 2. Same phone again, Management E
  p = await open(b, initData(user));
  await fill(p, { dept: 'Management', major: 'Business Administration with Applied AI', grade: 'E', q: '' });
  s = await state(); const r2 = s.leads[2];
  ok('2nd submit: Duplicate Yes, Lead ID ...-0002', r2 && r2[H.indexOf('Duplicate')] === 'Yes' && /-0002$/.test(r2[0]), r2 && r2[0]);
  ok('Management E fees $3,400 / $3,600', r2 && r2[H.indexOf('Partner Fee / Year')] === 3400 && r2[H.indexOf('Standard Fee / Year')] === 3600);

  // 3. Rate limit (3 per 10 min)
  const base = { action: 'submit', initData: initData(user), name: 'Sok Dara', gender: 'Male', phone: '097 123 4567', parentPhone: '', email: 'a@b.com',
    province: 'Kep', highSchool: 'Kep HS', department: 'Engineering', major: 'Cyber Security', grade: 'C', question: '', consent: true };
  ok('3rd submit accepted', (await post(base)).ok === true);
  const rl = await post(base); ok('4th submit RATE_LIMITED', rl.error && rl.error.code === 'RATE_LIMITED', JSON.stringify(rl));

  // 4. Server-side validation, bypassing the UI
  const u2 = { id: 777, first_name: 'X' };
  const bad = await post({ ...base, initData: initData(u2), phone: 'kk', email: 'abc@gmail', major: 'Medicine', consent: false });
  ok('Server rejects bad phone/email/major/consent', bad.error && bad.error.code === 'VALIDATION' && ['phone', 'email', 'major', 'consent'].every(f => bad.error.fields[f]), JSON.stringify(bad));
  const inj = await post({ ...base, initData: initData(u2), email: '=cmd@x.com', question: '=IMPORTXML("http://x")' });
  s = await state(); const last = s.leads[s.leads.length - 1];
  ok('Sheet formula injection neutralised', inj.ok && last[H.indexOf('Question')].startsWith("'=") && last[H.indexOf('Email')].startsWith("'="), JSON.stringify(inj));

  // 5. Authentication
  const t = initData(user).replace('sok_dara', 'hacker');
  const ua = await post({ ...base, initData: t }); ok('Tampered initData -> UNAUTHORIZED', ua.error && ua.error.code === 'UNAUTHORIZED');
  const old = await post({ ...base, initData: initData(u2, Math.floor(Date.now() / 1000) - 90000) });
  ok('25h-old initData -> UNAUTHORIZED', old.error && old.error.code === 'UNAUTHORIZED');
  p = await open(b, t); await fill(p, { phone: '016 222 333' });
  ok('UI: tampered session -> "Session Expired" + Close', await p.evaluate(() => document.querySelector('.screen.active').id === 'screen-error'
    && Telegram.WebApp.MainButton.text === 'Close' && document.getElementById('error-title').textContent.includes('Session')));

  // 6. Webhook
  const nSent = (await state()).sent.length;
  const w1 = await post({ update_id: 9001, message: { text: '/start', chat: { id: 555001, type: 'private' } } }, '?key=wrong');
  ok('Webhook with wrong key rejected', w1.error && w1.error.code === 'UNAUTHORIZED');
  const K = '?key=S3cretS3cretS3cretS3cretS3cret12';
  await post({ update_id: 9002, message: { text: '/start', chat: { id: 555001, type: 'private' } } }, K);
  await post({ update_id: 9002, message: { text: '/start', chat: { id: 555001, type: 'private' } } }, K);
  await post({ update_id: 9003, message: { text: '/start', chat: { id: -4000000001, type: 'group' } } }, K);
  s = await state(); const ws = s.sent.slice(nSent);
  ok('/start: one reply with web_app button (retry deduped, group ignored)', ws.length === 1 && ws[0].body.reply_markup.inline_keyboard[0][0].web_app.url === 'https://example.github.io/kit/', JSON.stringify(ws.map(x => x.body.chat_id)));

  // 7. Misc
  ok('Malformed JSON -> BAD_REQUEST', (await (await fetch(API, { method: 'POST', body: '{oops' })).json()).error.code === 'BAD_REQUEST');
  ok('GET health check', (await (await fetch(API)).json()).ok === true);
  ok('No CORS preflight (Apps Script cannot answer OPTIONS)', s.preflights.length === 0, JSON.stringify(s.preflights));
  ok('No ERROR rows in Log tab', !s.log.some(r => r[1] === 'ERROR'), JSON.stringify(s.log.filter(r => r[1] === 'ERROR')));

  await b.close();
  results.forEach(r => console.log(r.join('  ')));
  const passed = results.filter(r => r[0] === 'PASS').length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
