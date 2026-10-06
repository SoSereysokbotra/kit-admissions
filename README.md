# KIT Admissions Telegram Mini App — Deployment & Staff Operations Guide

This guide is written step-by-step for students and administrators to deploy and maintain the **Kirirom Institute of Technology (KIT)** Admissions Telegram Mini App.

---

## Architecture Overview

- **Frontend**: Static Web App (HTML/CSS/JS) hosted on **GitHub Pages**.
- **Backend API & Webhook**: Serverless Google Apps Script Web App.
- **Database**: Google Sheets (`Leads`, `Config`, `Log` tabs).
- **Telegram Bot**: Acts as the user entrance via Menu Button (`/start`) and sends admissions notifications to students and staff.

---

## Deployment Checklist (Step-by-Step)

### Step A: Create Telegram Bot via @BotFather
- [ ] 1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
- [ ] 2. Send `/newbot`.
- [ ] 3. Enter a friendly display name (e.g., `KIT Admissions Bot`).
- [ ] 4. Enter a unique username ending in `bot` (e.g., `kit_admissions_bot` or `kit_admissions_2026_bot`).
- [ ] 5. BotFather will provide an API token (format: `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`). **Copy and save this token.**

---

### Step B: Create Google Sheet & Add Backend Code
- [ ] 1. Open [Google Sheets](https://sheets.new) and create a blank spreadsheet. Name it **KIT Admissions Database 2026**.
- [ ] 2. In the top menu, click **Extensions > Apps Script**. Rename the Apps Script project to **KIT Admissions Backend**.
- [ ] 3. In the left sidebar of Apps Script, click **Project Settings** (gear icon ⚙️).
- [ ] 4. Check the box: **Show "appsscript.json" manifest file in editor**.
- [ ] 5. Click the **Editor** icon (`< >`) in the left sidebar.
- [ ] 6. Replace `appsscript.json` with the contents of [`backend/appsscript.json`](backend/appsscript.json).
- [ ] 7. In the left sidebar, click the **+** icon next to Files > **Script**, and create these four script files:
  - `Setup.gs`: Paste contents of [`backend/Setup.gs`](backend/Setup.gs).
  - `Code.gs`: Paste contents of [`backend/Code.gs`](backend/Code.gs).
  - `Validation.gs`: Paste contents of [`backend/Validation.gs`](backend/Validation.gs).
  - `Tests.gs`: Paste contents of [`backend/Tests.gs`](backend/Tests.gs).
- [ ] 8. Click **Save all files** (floppy disk icon 💾 or `Ctrl + S`).

---

### Step C: Run Database Setup & Authorize Permissions
- [ ] 1. In the Apps Script toolbar dropdown (next to "Debug"), select the function **`setup`**.
- [ ] 2. Click **Run**.
- [ ] 3. An **Authorization Required** dialog will pop up. Click **Review Permissions**.
- [ ] 4. Choose your Google account.
- [ ] 5. You will see: *"Google hasn't verified this app"*. Click **Advanced** (small text in the bottom left).
- [ ] 6. Click **Go to KIT Admissions Backend (unsafe)**. *(Note: This warning is standard for private scripts accessing your own Google Sheets).*
- [ ] 7. Click **Allow**.
- [ ] 8. Wait for `setup` to finish running (Execution log says *"Execution completed"*).
- [ ] 9. Return to your Google Sheet: verify that three tabs have been created and styled:
  - **`Leads`**: Headers formatted with alternating grey banding, frozen header row, phone columns formatted as plain text (`@`), and Status dropdowns.
  - **`Config`**: Seeded with default tuition rates, scholarships (Grades A–E), and department majors.
  - **`Log`**: Initial audit log record.

---

### Step D: Set Bot Token & Generate Webhook Secret
- [ ] 1. In Apps Script, go to **Project Settings** (gear icon ⚙️).
- [ ] 2. Scroll down to **Script Properties** and click **Add script property**.
  - Property: `BOT_TOKEN`
  - Value: *(Paste your token from @BotFather in Step A)*
- [ ] 3. Click **Save script properties**.
- [ ] 4. Return to the Editor (`< >`), select function **`generateWebhookSecret`**, and click **Run**.
- [ ] 5. View the Execution Log: you will see `✅ Generated WEBHOOK_SECRET (abcd…) and saved it to Script Properties.` You don't need to copy it.

---

### Step E: Create Admin Telegram Group & Find Chat ID
- [ ] 1. In Telegram, create a **New Group** named **KIT Admissions Leads** (or similar).
- [ ] 2. Add your new bot into this group as a member. Adding the bot is enough for the next step, because Telegram records that the bot joined the group.
- [ ] 3. Optional: in the group, send `/start@<your_bot_username>`. Bots don't see normal group messages, but they always see commands.
- [ ] 4. In Apps Script, select the function **`findAdminChatId`** and click **Run**. Do this **before** Step H: it doesn't work after the webhook is set.
- [ ] 5. Check the Execution Log: you will see a list of recent chats.
  - Look for your group title and copy the **Chat ID**. It is a negative number, e.g. `-4012345678` (normal group) or `-1002345678901` (supergroup).
  - If the list is empty, remove the bot from the group, add it again, and re-run.
- [ ] 6. Go to **Project Settings > Script Properties > Add script property**:
  - Property: `ADMIN_CHAT_ID`
  - Value: *(Your group ID, including the minus sign)*
- [ ] 7. Click **Save script properties**.

> [!NOTE]
> If you later change the group's settings (e.g. make it public), Telegram may upgrade it to a supergroup with a **new** `-100…` ID. Admin alerts then fail with "group chat was upgraded" errors in the `Log` tab. Update `ADMIN_CHAT_ID` if that happens.

---

### Step F: Deploy Apps Script Web App (API URL)
- [ ] 1. In the top right corner of Apps Script, click **Deploy > New deployment**.
- [ ] 2. Click the gear icon ⚙️ next to "Select type" and select **Web app**.
- [ ] 3. Configure deployment settings:
  - **Description**: `v1.0 Production`
  - **Execute as**: `Me (<your-email>)`
  - **Who has access**: `Anyone` *(Crucial: allows Telegram Mini App to submit)*
- [ ] 4. Click **Deploy**.
- [ ] 5. Copy the **Web app URL** (ends with `/exec`, e.g. `https://script.google.com/macros/s/AKfycb.../exec`).
- [ ] 6. Go to **Project Settings > Script Properties > Add script property**:
  - Property: `API_URL`
  - Value: *(The Web app URL ending in `/exec`)*
- [ ] 7. Click **Save script properties**.

> [!IMPORTANT]
> Whenever you modify code in `Code.gs`, `Setup.gs`, or `Validation.gs` in the future, DO NOT create a "New deployment". Instead, click **Deploy > Manage deployments > Edit (pencil icon) > Version: New version > Deploy**. This keeps your `API_URL` unchanged!

---

### Step G: Deploy Frontend to GitHub Pages
- [ ] 1. Open [`frontend/config.js`](frontend/config.js) in your local editor.
- [ ] 2. Set `API_URL` to your Web app URL from Step F:
  ```javascript
  window.APP_CONFIG = {
    API_URL: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
  };
  ```
- [ ] 3. On GitHub, create a new **public** repository (GitHub Pages is free only for public repos). Don't add a README there. No secrets are in the code: the bot token lives only in Script Properties.
- [ ] 4. Push this project folder to GitHub (run in the project folder):
  ```bash
  git init
  git add .
  git commit -m "Configure API_URL and prepare deployment"
  git branch -M main
  git remote add origin https://github.com/<your-username>/<repo-name>.git
  git push -u origin main
  ```
- [ ] 5. On GitHub, navigate to **Settings > Pages**.
- [ ] 6. Under **Build and deployment > Source**, select **GitHub Actions**.
- [ ] 7. Go to the **Actions** tab on GitHub. Wait ~1 minute for the **Deploy Frontend to GitHub Pages** workflow to complete with a green checkmark.
- [ ] 8. Open your deployed URL: `https://<your-username>.github.io/<repo-name>/?preview=1` in your browser. Verify the Welcome screen loads cleanly.
- [ ] 9. Copy your GitHub Pages URL **with a trailing slash** (e.g. `https://<your-username>.github.io/<repo-name>/`).
- [ ] 10. In Apps Script, go to **Project Settings > Script Properties > Add script property**:
  - Property: `WEBAPP_URL`
  - Value: `https://<your-username>.github.io/<repo-name>/`
- [ ] 11. Click **Save script properties**.

---

### Step H: Connect Bot & Verify Deployment
In Apps Script, select and run each of the following helper functions in order:
- [ ] 1. **`setupBotProfile`**: Sets `/start` command, the "Admissions" Menu Button, and bot descriptions.
- [ ] 2. **`setWebhook`**: Connects Telegram webhook to your `API_URL`.
- [ ] 3. **`getWebhookInfo`**: Confirms webhook is active with zero pending errors. *(Note: If you see HTTP 302 in the error message, this is normal for Google Apps Script redirects).*
- [ ] 4. **`sendTestMessage`**: Sends a confirmation message to your admin group.
  - Verify your Telegram admin group receives: `"✅ KIT Admissions bot connected"`.
- [ ] 5. **`checkDeployment`**: Runs self-tests and checks all 5 properties.
  - Verify Execution log outputs: `READY`.

---

### Step I: Live End-to-End Test in Telegram
- [ ] 1. Open Telegram and search for your bot username.
- [ ] 2. Press **Start** or tap the **Admissions** menu button at the bottom left.
- [ ] 3. The Mini App opens inside Telegram. Complete the 3-step registration:
  - Step 1: Name, Gender, Phone, Email.
  - Step 2: Province, High School, Department, Major, BAC II Grade.
  - Step 3: Review your details, check the consent box, and tap **Calculate Tuition**.
- [ ] 4. Verify results:
  - **Mini App**: Shows tuition estimation table with partner & standard school rates.
  - **Telegram Chat**: Student receives direct confirmation with scholarship breakdown.
  - **Admin Group**: Admissions counselors receive detailed lead notification with direct phone and email.
  - **Google Sheets**: A new row appears on the `Leads` tab with status `"New"`.

---

### Step J: Go Live (Phase 6)
- [ ] 1. **Keep the old data:** in the old "Admission Lead" spreadsheet, right-click its tab → **Copy to → Existing spreadsheet** → choose the new sheet. Rename the copied tab `Old Leads (2026)`. Don't paste old rows into `Leads`: the column layout is different.
- [ ] 2. **Remove your test rows:** in `Leads`, delete every row you created while testing (select the row numbers → right-click → **Delete rows**). Keep row 1 (headers).
- [ ] 3. Old bot (@kittuitionfee_bot): if you have its token (ask your senior, or BotFather → `/mybots` if you own it), you can use **that** token in Step D instead of creating a new bot. Students keep the same bot and it starts running the new app. Otherwise, ask the owner to turn the old bot off so students don't use the broken version.
- [ ] 4. Demo to Mr. Leo: open the bot on a phone, submit once, and show the result screen, the admin group alert, the new row in `Leads`, and the red highlight rule.

---

## Running the Automated Tests (for developers)

There are two test suites. Neither one touches your real Sheet or sends real Telegram messages.

**1. Backend self-tests (inside Google):** in Apps Script, run `runSelfTests()` (or `checkDeployment()`, which includes it). It covers all 20 fee combinations, validation, Telegram signature checking, HTML escaping and money formatting.

**2. End-to-end test (on your computer):** runs the real `frontend/` in Chrome against the real `backend/*.gs` code, with Google Sheets, Telegram and the other Google services replaced by in-memory fakes. Requires Node.js 18+ and Google Chrome.

```bash
cd tests
npm install
npm run server        # terminal 1: fake Apps Script API on :8766 + frontend on :8765
npm test              # terminal 2: expect "36/36 passed"
```

If Chrome is installed somewhere else, set `CHROME_PATH` to its path. To click through the app yourself, run `npm run server` and open http://127.0.0.1:8765/index.html?preview=1.

Run both suites after every code change, **before** deploying a new version.

---

## Troubleshooting Guide

| Symptom | Probable Cause | Fix / Action |
| :--- | :--- | :--- |
| **"Open in Telegram" screen shown inside Telegram** ("Please open this from the KIT Telegram bot") | Bot opened in external browser or Telegram `initData` is empty | Open the bot directly inside Telegram mobile or desktop app using the menu button. If testing locally in a web browser, append `?preview=1` to the URL. |
| **"Session expired" / `UNAUTHORIZED` error on submit** | Invalid or stale `initData` HMAC token | Close and re-open the Mini App from Telegram. If persists, verify `BOT_TOKEN` in Script Properties matches @BotFather token exactly without spaces. |
| **Admin gets nothing (admin group receives no notifications)** | Incorrect `ADMIN_CHAT_ID` or bot not added to group | Ensure the bot is added to the admin group with permission to send messages. Run `findAdminChatId()` again and verify `ADMIN_CHAT_ID` in Script Properties is the negative group ID, including the minus sign. To re-run `findAdminChatId()`, run `deleteWebhook()` first and `setWebhook()` afterwards. |
| **Student gets no message (403 Forbidden)** | Student blocked the bot or never pressed `/start` | Telegram forbids bots from initiating direct messages unless the student has previously pressed `/start`. Counselors can still contact the student via phone. |
| **302 in getWebhookInfo (`HTTP 302`)** | Google Apps Script standard HTTP redirect | **Normal and expected.** Google Apps Script always issues a 302 redirect for Web Apps. The script executes normally, and duplicates are ignored via `update_id` deduplication. |
| **Config error (`CONFIG_ERROR`) on screen** | Corrupted, empty, or missing keys in `Config` tab | In Apps Script, run `readConfig()`. Check Execution Log to identify any missing keys or invalid numbers. Ensure sum of rates does not exceed 100%. |
| **Changes not showing (forgot New version / cache 5 min / GitHub Pages cache)** | Stale deployment version or cached response | • For Apps Script code changes: Click Deploy > Manage deployments > Edit > **New version** > Deploy.<br>• For Config sheet changes: Takes up to 5 minutes to refresh (Script cache TTL 300s).<br>• For GitHub Pages frontend changes: Wait for GitHub Actions build to complete, then hard refresh (`Ctrl + Shift + R`) or clear Telegram web cache. |
| **Phone numbers converted to scientific notation (e.g. `1.23E+08`)** | Plain text number format removed from Sheet | The `setup()` function sets column format to `@` (Plain text). Do not reformat the Phone columns as "Number" in Google Sheets. |

---

## How to Update Tuition & Scholarships (Staff Guide)

Tuition fees, scholarship rates, and available majors are managed directly from the **`Config`** tab in the Google Sheet. **No code edits and no redeployments are required!**

1. Open your **KIT Admissions Database 2026** Google Sheet.
2. Click the **`Config`** tab at the bottom.
3. Edit the value in Column B (`Value`):
   - `base_engineering`: Base annual tuition for Engineering (e.g. `5000`).
   - `base_management`: Base annual tuition for Management (e.g. `4000`).
   - `extra_offer`: Promotional percentage bonus for mini app applicants (e.g. `10`).
   - `rate_partner_A` through `rate_partner_E`: Base scholarship percentages for Partner schools.
   - `rate_standard_A` through `rate_standard_E`: Base scholarship percentages for Standard schools.
   - `majors_engineering`: Semicolon-separated list of majors (e.g. `Software Engineering; Cyber Security`).
   - `majors_management`: Semicolon-separated list of majors.
4. **Cache Notice**: The backend caches configuration for **5 minutes** (300 seconds) to ensure high performance. Changes will reflect automatically within 5 minutes.

---

## Counselor & Staff Workflow Guide

Admissions officers manage incoming student leads on the **`Leads`** tab:

1. **New Leads**: Every submission automatically arrives with **`Status = "New"`**.
2. **24-Hour Follow-Up Alert**:
   - If a lead remains with Status `"New"` for **24 hours or longer**, the entire row automatically highlights in **soft red** with dark red text.
   - Counselors should prioritize red rows immediately.
3. **Updating Leads**:
   - **`Status`**: Click the dropdown arrow to select:
     - `Contacted`: Student has been called or messaged.
     - `No answer`: Attempted contact, waiting for callback.
     - `Applied`: Student has submitted formal admission application.
     - `Not interested`: Student declined enrollment.
   - **`Counselor`**: Enter the staff member's name handling the inquiry.
   - **`Contacted At`**: Double-click to select the date contact was made.
   - Once the Status changes from `"New"` to any other value, the red overdue highlight automatically clears!
