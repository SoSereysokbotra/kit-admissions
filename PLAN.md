# KIT Admissions Mini App — Rebuild Plan

Telegram Mini App for prospective students to register interest and get a Year-1 tuition estimate.
Replaces the senior's version (`index.html` + `code.gs`), which is kept as reference only.

## Status (2026-10-07): live

| Phase | Status | Evidence |
|---|---|---|
| 0. Project setup | ✅ Done | Folders, `legacy/`, local logo |
| 1. Google Sheet | ✅ Done | Live Sheet set up by `setup()`; Leads, Config, Log tabs |
| 2. Backend API | ✅ Done | 39/39 self-tests (`runSelfTests`); Telegram signature check verified against an independent reference |
| 3. Frontend | ✅ Done | Headless Chrome at 360 px: all screens, validation, dark mode, no sideways scrolling |
| 4. Bot integration | ✅ Live on official bot `@kit_admissions_bot` (tested first on `@kittuitionfee_test_bot`) | Backend web app live; frontend at https://sosereysokbotra.github.io/kit-admissions/; `checkDeployment` READY |
| 5. Testing | ✅ Automated + live | `tests/`: 38/38 end-to-end; live Telegram submit `KIT-261006-0001` → result screen, student message, admin alert, Sheet row (leading 0 kept) all verified |
| 6. Launch & handover | ✅ Done (2026-10-07) | Test rows cleared, bot photo + one-tap Mini App link set, test bot removed, handed to Mr. Leo; old `@kittuitionfee_bot` (senior's) to be retired |

---

## Decisions (confirmed)

| Topic | Decision |
|---|---|
| Base tuition | Engineering **$5,000/year**, Management **$4,000/year** |
| Extra offer | **+10 percentage points** on top of the grade rate, for everyone who uses the app |
| Email | **Required**, must be a valid address (contains `@` and a domain) |
| Partner school | No partner list available → show **both** Partner and Standard columns |
| Hosting | Frontend on **GitHub Pages** (free, HTTPS); backend stays on **Google Apps Script** |
| Language | **English only** |
| Admission fee | Note stays: **one-time $500 admission fee not included** |
| Callback promise | "A counselor may call you within **24 hours**" |

## Scholarship rules

| BAC II grade | Partner rate | Standard rate |
|---|---|---|
| A | 55% + 10% = **65%** | 50% + 10% = **60%** |
| B | 40% + 10% = **50%** | 30% + 10% = **40%** |
| C | 20% + 10% = **30%** | 10% + 10% = **20%** |
| D | 10% + 10% = **20%** | 5% + 10% = **15%** |
| E | 5% + 10% = **15%** | 0% + 10% = **10%** |

Year-1 only. Results are estimates, subject to KIT's confirmation. Year 2 onward: performance-based merit scholarships.

---

## Architecture

```
Telegram bot ──(Menu Button / /start)──► Mini App (static site, GitHub Pages)
                                              │  POST JSON + Telegram initData
                                              ▼
                                   Google Apps Script (JSON API)
                                     ├─ verify initData signature (HMAC-SHA256)
                                     ├─ validate all fields again
                                     ├─ calculate fees from Config sheet
                                     ├─ append row to Leads sheet
                                     ├─ notify admin group (HTML, escaped)
                                     └─ send fee summary to student's chat
```

### Why this changes from the old version

| Old problem | Fix |
|---|---|
| Page served by Apps Script → Telegram SDK runs inside Google's iframe, `user.id` is empty, student never gets their message | Static frontend on GitHub Pages; real Telegram SDK |
| Webhook gets a 302 from Apps Script → Telegram retries → duplicate `/start` replies | Mini App opened from BotFather Menu Button; `/start` kept minimal with dedupe |
| Markdown not escaped → admin alert silently fails when a name contains `_` or `*` | HTML parse mode + escaping; log Telegram errors |
| Phone numbers lose the leading 0 in the Sheet | Phone columns formatted as plain text |
| Scholarship rates wrong (Standard D, Partner E) and no extra 10% | Rates from Config sheet, matching the table above |
| No validation on the server, no request authentication | Server-side validation + initData signature check |
| Name starting with `=` runs as a formula | Sanitize cell values |
| Free-text province ("PP", "Pp", "Phnom Penh") | Dropdown of the 25 provinces |
| No way to track whether a lead was called | Status / Counselor / Contacted At columns + overdue highlight |

---

## Phase 0 — Project setup

**Tasks**
- [ ] Create folder structure:
  ```
  /frontend    index.html, app.js, styles.css, assets/logo.jpg
  /backend     Code.gs, Setup.gs, appsscript.json
  /legacy      old index.html, code.gs (reference only)
  README.md    deployment guide
  PLAN.md      this file
  ```
- [ ] Move the senior's files into `/legacy`.
- [ ] Get the official KIT logo file (stored locally, not hotlinked).
- [ ] Create a GitHub repo for the frontend.

**Done when:** folders exist, old code archived, logo in `assets/`.

---

## Phase 1 — Google Sheet (database)

**Tasks**
- [ ] Write `Setup.gs → setup()` that creates/repairs the tabs below in one click.
- [ ] **`Leads` tab** with columns:

  | Column | Notes |
  |---|---|
  | Lead ID | `KIT-YYMMDD-XXXX` |
  | Timestamp | Phnom Penh time (Asia/Phnom_Penh) |
  | Name, Gender | |
  | Phone, Parent Phone | **Text format**, digits only, e.g. `012345678` |
  | Email | |
  | Province, High School | |
  | Department, Major, Grade | |
  | Partner %, Standard % | Final rate incl. extra 10% |
  | Partner Fee / Year, Standard Fee / Year | Year-1 estimate |
  | Question | |
  | Telegram ID, Telegram Username | From verified initData |
  | Status | Dropdown: New / Contacted / No answer / Applied / Not interested |
  | Counselor | Free text |
  | Contacted At | Date |
  | Duplicate | `Yes` if the phone already exists in an earlier row |

- [ ] Formatting: frozen header row, bold header, column widths, alternating colours.
- [ ] Conditional formatting: row turns **red** when Status = `New` and Timestamp is older than 24 hours.
- [ ] **`Config` tab** (key / value) so staff can change numbers without code:
  - `base_engineering = 5000`, `base_management = 4000`
  - `extra_offer = 10`, `admission_fee = 500`, `callback_hours = 24`
  - Rate table: grade × (partner, standard)
  - Majors per department
- [ ] **`Log` tab**: errors from the backend (failed Telegram sends, rejected requests).

**Done when:** running `setup()` on an empty spreadsheet produces all three tabs, correctly formatted, and running it again changes nothing.

---

## Phase 2 — Backend (Apps Script API)

**Tasks**
- [ ] `doPost(e)` router with two kinds of requests:
  - `action: "getConfig"` → returns majors, rates, fees (for the frontend).
  - `action: "submit"` → saves a lead and returns the fee result.
  - Telegram webhook update (`update_id` present) → handles `/start`.
- [ ] Store secrets in **Script Properties** (not in code): `BOT_TOKEN`, `ADMIN_CHAT_ID`, `WEBAPP_URL`.
- [ ] **initData verification**: HMAC-SHA256 check per Telegram docs; reject if invalid or older than 24 h. Take the user ID from verified data only.
- [ ] **Server-side validation** (same rules as frontend, see Phase 3). Return field-level errors as JSON.
- [ ] **Fee calculation** (`calculateFees(department, grade)`):
  - `rate = gradeRate + extra_offer`
  - `yearly = base × (1 − rate/100)`, `semester = yearly / 2`, `quarter = yearly / 4`
  - Rounded to 2 decimals; shown without `.00` when whole.
- [ ] **Save row** with `LockService` (no clashes when two students submit at once); sanitize values starting with `= + - @`; mark duplicates by phone.
- [ ] **Admin notification** to the admin group: HTML mode, all user text escaped, includes Lead ID, tap-to-call phone, grade, major, scholarship %.
- [ ] **Student message** to their chat: summary of the estimate + 24-hour callback note + disclaimer.
- [ ] **Rate limit**: max 3 submissions per Telegram user per 10 minutes (CacheService).
- [ ] Every Telegram API failure written to the `Log` tab instead of being silently ignored.

**Done when:** the API can be called with a test script, returns correct fees for all 20 combinations (see Phase 5), rejects bad input, and both Telegram messages arrive.

---

## Phase 3 — Frontend (Mini App)

### Screens
1. **Welcome** — KIT logo, "Year-1 Tuition Estimator", short explanation, Start button.
2. **Step 1 · About you** — Full name, Gender, Phone, Parent phone (optional), Email.
3. **Step 2 · Your studies** — Province (dropdown), High school, Department, Major (filtered by department), BAC II grade, Question (optional).
4. **Step 3 · Review** — summary of entered data with "Edit" links, consent checkbox *"I agree that KIT may contact me about admission."*
5. **Result** — scholarship and fee table, notes, done button.

Progress bar across steps 1–3. Telegram **MainButton** for Next / Submit, **BackButton** for going back, haptic feedback on errors and success.

### Validation rules

| Field | Rule |
|---|---|
| Full name | Required, 2–60 characters, letters / spaces / `.` `'` `-` only |
| Gender | Required: Male / Female / Other |
| Phone | Required. **Digits only** (letters blocked while typing, numeric keyboard). Must start with `0`, total **9 or 10 digits**. `+855…` / `855…` accepted and converted to `0…`. Prefix must be a Cambodian mobile prefix: 010–018, 031, 038, 060, 061, 066–071, 076–081, 083–090, 092, 093, 095–099 (list kept in one place in code, served by the API). Shown as `012 345 678`. |
| Parent phone | Optional; same rules if filled; must differ from student phone |
| Email | **Required**. Format `name@domain.tld`. Warning (not block) for common typos: `.con`, `gmial.com`, `gmail.co`. |
| Province | Required, one of the 25 provinces |
| High school | Required, 2–100 characters |
| Department / Major / Grade | Required, must be from the list |
| Question | Optional, max 500 characters |
| Consent | Required |

- Errors appear **under the field** in red, shown after the user leaves the field or presses Next — no `alert()` popups.
- The Next button only moves on when the current step is valid.

### Result screen

```
Software Engineering · Grade A
Base tuition: $5,000 / year

                     Partner school    Standard school
Scholarship          55% + 10% = 65%   50% + 10% = 60%
Pay yearly           $1,750            $2,000
Pay per semester     $875              $1,000
Pay per quarter      $437.50           $500

• One-time admission fee of $500 is not included.
• Estimate only, subject to KIT's confirmation.
  From Year 2, scholarships are performance-based.
📞 A counselor may call you within 24 hours.
```

### Quality
- Follows Telegram theme (light/dark) via `themeParams`.
- Mobile-first, no horizontal scroll at 360 px width.
- Loading state while submitting; button disabled to prevent double submit.
- Clear error screen if the network fails, with a Retry button (form data kept).
- Draft saved in `localStorage`, so closing the app by accident doesn't lose input.
- If opened outside Telegram → friendly message "Please open this from the KIT Telegram bot."

**Done when:** all screens work inside Telegram on Android and iOS, every validation rule behaves as in the table above.

---

## Phase 4 — Bot integration

**Tasks**
- [ ] Deploy frontend to GitHub Pages → get HTTPS URL.
- [ ] Deploy Apps Script as Web App (Execute as: Me, Access: Anyone) → get API URL, put it in frontend config.
- [ ] In **@BotFather**: set Menu Button and Main Mini App to the GitHub Pages URL; set bot description, about text, and profile picture.
- [ ] `/start` reply: short welcome + "Open Admissions App" button (deduplicated by `update_id`).
- [ ] Create admin Telegram group, add bot, store its chat ID in Script Properties.
- [ ] Helper functions in `Setup.gs`: `setWebhook()`, `getWebhookInfo()`, `sendTestMessage()`.

**Done when:** a new Telegram user can find the bot, tap the menu button, submit, and both the student and the admin group receive their messages.

---

## Phase 5 — Testing

### Fee check (all 20 combinations)

| Dept | Grade | Partner % | Partner / year | Standard % | Standard / year |
|---|---|---|---|---|---|
| Engineering ($5,000) | A | 65% | $1,750 | 60% | $2,000 |
| | B | 50% | $2,500 | 40% | $3,000 |
| | C | 30% | $3,500 | 20% | $4,000 |
| | D | 20% | $4,000 | 15% | $4,250 |
| | E | 15% | $4,250 | 10% | $4,500 |
| Management ($4,000) | A | 65% | $1,400 | 60% | $1,600 |
| | B | 50% | $2,000 | 40% | $2,400 |
| | C | 30% | $2,800 | 20% | $3,200 |
| | D | 20% | $3,200 | 15% | $3,400 |
| | E | 15% | $3,400 | 10% | $3,600 |

### Validation check

| Input | Expected |
|---|---|
| Phone `kk`, `abc123` | Letters cannot be typed |
| Phone `123`, `168` | "Enter a valid Cambodian phone number" |
| Phone `012345678`, `0971234567` | Accepted |
| Phone `+855 12 345 678` | Accepted, saved as `012345678` |
| Email empty | "Email is required" |
| Email `abc`, `abc@`, `abc@gmail` | Rejected |
| Email `abc@gmail.con` | Warning shown, can confirm |
| Name `=HYPERLINK(...)` | Rejected by name rule; sanitized on server anyway |
| Name `Long_sophan*` | Admin message still delivered correctly |

### Other checks
- [ ] Submit twice with same phone → second row marked Duplicate.
- [ ] Two phones submitting at the same moment → both rows saved.
- [ ] Request with fake/missing initData → rejected, logged.
- [ ] Changing a value in `Config` sheet → reflected in the app without redeploying.
- [ ] Light and dark Telegram theme, Android + iOS + Telegram Desktop.
- [ ] Phone leading 0 preserved in Sheet.

**Done when:** every row above passes.

---

## Phase 6 — Launch & handover

**Tasks**
- [ ] Clear test rows from the `Leads` sheet (keep a copy of the old data in a separate tab).
- [ ] `README.md`: step-by-step deploy guide, how to change fees in `Config`, how to update the bot, troubleshooting.
- [ ] Short staff guide: how to use the Status / Counselor / Contacted At columns and the red overdue highlight.
- [ ] Demo to Mr. Leo for sign-off.

**Done when:** teacher approves and the bot is live.

---

## Out of scope (possible later)
- Khmer language
- Partner high-school list (auto-select rate instead of showing both columns)
- Admin dashboard (charts of leads by province / major)
- Automatic reminder to counselors when a lead is overdue
