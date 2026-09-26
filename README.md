# Holter Box Check

A simple staff website for recording checks of the Holter drop-off box.

**Website:** https://holter-box-check.pages.dev/

## How it works

Enter the six-digit staff passcode, view the latest check, then tap **I checked the box** and enter your initials or name. The menu contains history, the physical box lock code, and a printable website QR code.

- Keeps the **latest 20 checks**; older checks are automatically deleted.
- Stores server timestamps in UTC and displays them in **America/Vancouver** time.
- Accepts letters and numbers for initials or names. The shared passcode does **not** verify who entered them.
- Do not enter patient information or Holter identifiers.
- Sessions expire after 20 minutes; reloading returns to the passcode screen.
- Passcode attempts are rate-limited, and retrying a check uses the same request to prevent duplicates.

Built with TypeScript, Cloudflare Pages, Pages Functions, and D1 on the free plans. No paid domain is required; free-plan quotas can temporarily interrupt service.

## Local setup

Requires Node.js 20.19+ and npm. Use test-only information locally.

1. Run `npm ci`.
2. Copy `.dev.vars.example` to `.dev.vars` and set:
   - `PASSCODE`: six digits.
   - `IP_HASH_SECRET`: a long random value.
   - `LOCK_CODE_KEY`: a separate random 64-character hex value.
3. Generate random secrets with:
   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```
4. Run `npx wrangler d1 migrations apply holter-box-check --local`.
5. Run `npm run build`, then `npm run dev`. Open http://localhost:8788.

Run `npm test` for tests. Add new schema changes to `migrations/`; do not edit deployed migrations. Never commit `.dev.vars`, passcodes, or backups.

## Deploy an update

The existing Pages project uses **Direct Upload**. Pushing to GitHub does not deploy it.

1. Run `npm ci`, `npm test`, and `npm run build`.
2. Run `npx wrangler login` if needed, then `npx wrangler whoami` to check the account.
3. Apply new migrations with `npx wrangler d1 migrations apply holter-box-check --remote`.
4. In the Pages project's **Settings → Variables and Secrets**, set `PASSCODE`, `IP_HASH_SECRET`, and `LOCK_CODE_KEY` as encrypted Production secrets. The D1 binding is configured in `wrangler.jsonc`.
5. Set **Settings → Runtime → Fail open / closed** to **Fail closed**.
6. Run `npx wrangler pages deploy dist --project-name holter-box-check --branch main`.
7. Check that the site opens to the keypad and `/api/status`, `/api/history`, and `/api/lock-code` return `401` without a session.

## Change codes

**Website passcode:** change the encrypted `PASSCODE` secret to six random digits and redeploy. Existing sessions are invalidated.

**Physical lock:** change the lock itself, then update **Box lock code → Edit code**. Editing the website's saved code does not change the hardware. Anyone with the staff passcode can view or edit it. Keep `LOCK_CODE_KEY` backed up securely; losing or changing it makes the existing saved code unreadable.

## Back up history

Export the checks table:

```sh
npx wrangler d1 export holter-box-check --remote --table checks --output=holter-checks-backup.sql
```

Omit `--table checks` for a full database backup. Full backups include sessions and the encrypted lock code. Keep backups private, outside Git, and test restoration in a separate database. Exported records do not expire with the 20-check limit.

## Print the QR code

Open **Website QR code** in the menu, then choose **Zoom in** or **Print QR code**.

After the final URL is known, generate or refresh the QR poster with:

```sh
npm run qr -- https://holter-box-check.pages.dev/
```

This creates `qr-poster.html` and updates `public/website-qr.svg`. If the URL changes, update it in `index.html`, rebuild, and deploy. Test the printed code with a phone. The QR code contains no passcode.
