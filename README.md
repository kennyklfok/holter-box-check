# Holter Box Check

A small staff-only website for logging checks of the Holter drop-off box at the main entrance. The browser never receives the shared passcode from the server. Latest status, history, and check submissions all require a live server-side session. Check times are created on the server in UTC and displayed in **America/Vancouver** time.

## What it stores

Each check stores only the time and the staff initials or name entered. Letters and numbers are allowed in that field. Do **not** enter patient names, Holter identifiers, or other patient information. The shared passcode does **not** verify that an entered name or initials belong to the person making a check. This version has no individual staff accounts or audit-grade identity verification.

D1 keeps only the **20 most recent checks**. Recording a new check automatically deletes the oldest one once the limit is reached. Applying migration `0003` also deletes any existing checks beyond the newest 20. Separately exported backups do not expire automatically.

The **Box lock code** menu item stores the four-digit code currently set on the physical box lock. It does not change the lock hardware. Staff who know the shared six-digit website passcode can show or replace the saved code. The code is encrypted before storage in D1 using a separate deployment secret; it is revealed only when an authenticated staff member presses **Show code**. The hidden dots match the length of the saved code, including any older code saved before the four-digit rule. Do not put the physical lock code in Git, chat, or documentation.
The revealed code hides again after 30 seconds or when the page leaves the foreground. Returning to Box status or bringing its tab back into view refreshes the latest check without adding background polling.

Sessions last 20 minutes, are kept in D1, and use an opaque `HttpOnly; Secure; SameSite=Strict` cookie. Each fresh page load clears the previous session before accepting the passcode, so scanning the QR code opens directly to the passcode screen. There is no visible logout control; staff should close the tab after use. Changing either deployment secret invalidates existing sessions. Passcode attempts are limited to 10 per IP address per 15-minute window using an HMAC-hashed IP key in D1. Staff behind one hospital network address share that limit. A repeated check request ID creates only one record. Server and database failures return an error rather than exposing data.

The website login and box lock editor use on-screen PIN pads rather than password inputs, and the initials/name field requests no autocomplete. This reduces password-save and autofill prompts. Browsers and installed password managers may still show their own prompts; hospital IT should disable password saving and form autofill on shared devices if those prompts must be suppressed completely. The session cookie is not a saved password.

The website unlocks automatically after the sixth digit. A wrong PIN clears the dots and briefly disables the pad before allowing another attempt; server rate limiting still applies. Light vibration accompanies PIN taps and check actions when the device supports the Vibration API. iPhone Safari does not currently support that API, so those taps have visual feedback only.

Successful checks show a floating confirmation for 10 seconds without moving the status. History labels recent Vancouver calendar dates as Today or Yesterday, including across daylight-saving changes; older entries show the full date. If a save cannot be confirmed, the dialog offers Retry check with the same request ID to avoid duplicate records. Closing the dialog and starting a new check creates a new request ID.

## Local setup

Requires Node.js 20.19+ and npm. Use **test-only** passcodes and initials locally.

1. Run `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars`. Replace `PASSCODE` with a test-only six-digit number. Set `IP_HASH_SECRET` to a long random value. Set `LOCK_CODE_KEY` to a separate 32-byte hex value. Generate each with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Do not commit `.dev.vars`.
3. Run `npx wrangler d1 migrations apply holter-box-check --local`. Wrangler uses an isolated local D1 database even though `wrangler.jsonc` contains the remote database ID.
4. Run `npm run build`, then `npm run dev`. Open `http://localhost:8788`.
5. Run `npm test` for focused API tests. Run `npm run build` again after edits.

The local D1 data is stored under `.wrangler/` and is not committed. SQL migrations are in `migrations/`. When changing the schema, add a new numbered migration and apply it locally and remotely; do not edit a migration already deployed.

## Deploy to Cloudflare Pages

The Cloudflare Pages project and D1 database have been created on the free plan. The production URL is `https://holter-box-check.pages.dev/`. This project uses **Wrangler Direct Upload**; the GitHub repository holds source code, but pushing to GitHub alone does not redeploy the site. No paid domain is needed. Cloudflare's free quotas can make the service temporarily unavailable when reached.

To deploy a reviewed update:

1. Check out the desired commit from the GitHub repository. Run `npm ci`, `npm test`, and `npm run build`.
2. Authenticate to the intended Cloudflare account with `npx wrangler login` if needed. Confirm it with `npx wrangler whoami`.
3. If there are new migrations, run `npx wrangler d1 migrations apply holter-box-check --remote`. The `DB` binding and remote database ID are already in `wrangler.jsonc`.
4. In **Workers & Pages → holter-box-check → Settings → Variables and Secrets**, ensure `PASSCODE`, `IP_HASH_SECRET`, and `LOCK_CODE_KEY` are encrypted **Secret** values for Production. `PASSCODE` must be exactly six digits; use a random sequence rather than a common PIN. `LOCK_CODE_KEY` must be a random 32-byte value encoded as 64 hex characters. Set or change secrets in the dashboard or with Wrangler; never put them in source, GitHub, a QR code, or a client build.
5. In **Settings → Runtime → Fail open / closed**, ensure **Fail closed** is selected. This is essential because Functions protect the API when the free Functions quota is exhausted.
6. Run `npx wrangler pages deploy dist --project-name holter-box-check --branch main`. The `functions/` directory supplies Pages Functions, and the Wrangler configuration binds D1.
7. Verify the production URL: a private browser session should see the passcode form; `/api/status`, `/api/history`, and `/api/lock-code` should return `401` without a session; an authorized test check should appear once in latest and history. Use test initials and a test-only lock code during verification and arrange any test-record cleanup through the approved retention process before staff use.
8. After IT approval, give staff the passcode through an approved internal channel. Generate and print the QR poster **after** the final URL is fixed (below), and test the printed code with a phone.

Keep preview deployments separate from the production D1 database and secrets. Preview URLs are public by default, so restrict them if you add a preview workflow.

Do not enable public caching for `/api/*`; the API sends `Cache-Control: no-store`. Static assets call only the same-origin API. The `_routes.json` file invokes Functions only for `/api/*`, reducing free-tier use. The entire UI is intentionally public static code; all check data stays behind the API.

### Change the passcode

Change the encrypted `PASSCODE` secret in the Pages project to exactly six random digits and redeploy. Existing sessions automatically stop working because their stored secret version no longer matches. Distribute the new passcode through an approved channel. If `IP_HASH_SECRET` is also rotated, sessions are likewise invalidated and login-attempt keys change.

The physical **box lock code** is separate from the website passcode. Change it on the physical lock, then use **Box lock code → Edit code** to update the saved copy. If `LOCK_CODE_KEY` is lost or rotated, the saved code cannot be decrypted; have an authorized staff member confirm the physical lock code and save it again under the new key.

### Export or back up history

Run `npx wrangler d1 export holter-box-check --remote --table checks --output=holter-checks-backup.sql` to export the checks table. For a full database backup, omit `--table checks`. Store exports in an IT-approved location with appropriate access and retention; do not commit them to Git. A full export includes session and login-attempt data, so keep it more restricted. Test restoration in a separate D1 database before relying on a backup procedure.

A full export also contains the **encrypted** physical lock code. Keep a secure backup of `LOCK_CODE_KEY` under IT control if restoring that code from a database backup is required; the database export alone cannot decrypt it.

### Print the QR code

After login, open **Website QR code** from the menu. **Zoom in** opens the vector QR code in a new tab, and **Print QR code** opens the browser's print dialog with a clean QR page. No Adobe software is needed.

To regenerate the QR code if the final URL changes, run:

```sh
npm run qr -- https://holter-box-check.pages.dev/
```

This updates the bundled `public/website-qr.svg` and creates a self-contained `qr-poster.html` with the exact URL encoded in a high-correction QR code. If the URL changes, also update the displayed URL and image description in `index.html`, then rebuild and deploy. You can open the local poster and print it at 100% scale. `qr-poster.html` is ignored by Git. The QR code contains no passcode.

## IT approval before staff use

- Approve use of Cloudflare Pages and D1 for this staff activity, including organizational security review, data location, privacy requirements, and the fact that staff names or initials are retained in D1.
- Approve the 20-check D1 retention limit and set a retention and deletion policy for any exported backups. Assign an owner for the passcode, secret rotation, account recovery, and incident response.
- Approve storing the physical lock code in this app. Anyone with the shared website passcode can reveal or replace the saved code, and the app cannot verify whether it matches the physical lock. Decide who may edit the physical lock and its saved code.
- Decide how the shared passcode is distributed and how staff close the page on shared devices. A session remains usable in an open tab for up to 20 minutes; a fresh load clears it. Confirm that a shared passcode and self-entered name are acceptable for this operational record; they do not establish individual identity.
- Confirm network access and mobile scanning at the entrance. Approve placement and maintenance of the printed QR code so it continues to point to the intended pages.dev URL.
- Accept the free plan's quotas and lack of guaranteed availability for this workflow. If availability or stronger identity controls are required, IT should choose those before go-live.

## Reference documentation

- [Cloudflare Pages Git deployment](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Pages Functions routing and fail-closed setting](https://developers.cloudflare.com/pages/functions/routing/)
- [Pages D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [D1 Wrangler migrations and exports](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)
