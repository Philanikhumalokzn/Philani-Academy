# Philani Academy for Mathematics

Prototype Next.js app for Philani Academy.

Features:
- Signup / Authentication (NextAuth + Credentials)
- SQLite via Prisma
- Simple session creation that stores a join URL (redirect to Teams/Padlet/etc.)

Getting started

1. Install dependencies

```powershell
cd philani-academy; npm install
```

2. Copy environment

```powershell
cp .env.example .env
# Edit .env: set NEXTAUTH_SECRET and (optionally) STRIPE_SECRET
```

3. Setup Prisma DB

```powershell
npx prisma generate
npx prisma migrate dev --name init
```

4. Run dev server

```powershell
npm run dev
```

Open http://localhost:3000

Notes
- This is a prototype. For production, configure a proper database, HTTPS, secure secrets, and Stripe settings.
- When deploying to Vercel, create a Blob store and expose the `BLOB_READ_WRITE_TOKEN` environment variable so lesson material uploads work. Without it the API falls back to writing into `public/materials`, which only functions during local development.
- PayFast onsite subscription setup is documented in `docs/PAYFAST_ONSITE.md`. Follow it when enabling inline payments.
- Mathpix backup handwriting recognition requires `MATHPIX_APP_ID` and `MATHPIX_APP_KEY` on the server (used by `POST /api/mathpix/strokes`).
- Build note: Next.js 16 currently emits a persistent `baseline-browser-mapping` staleness warning from its compiled `browserslist` bundle even when `baseline-browser-mapping` is up to date.
- This repo includes `scripts/silence_baseline_warning.js` and runs it automatically via `postinstall` and `npm run build` (`silence:baseline-warning`) to keep CI and local build logs clean.
- If you upgrade Next.js and the warning behavior changes, re-check whether this patch is still needed.

Email & phone verification
- Signups and admin-invited users now receive a 6-digit email verification code. Learners confirm it on `/verify-email`, which posts to `POST /api/auth/verify-email`.
- The default code lifetime is 10 minutes; override with `EMAIL_VERIFICATION_TOKEN_TTL_MS` (milliseconds) if you need longer or shorter validity.
- Admin accounts (including the bootstrap user `admin@philani.test`) bypass verification. Provide a comma-separated override in `ADMIN_VERIFICATION_BYPASS_EMAILS` when needed.
- Set `REQUIRE_PHONE_VERIFICATION=1` if you later add SMS/voice verification and want sign-in to enforce a verified phone timestamp. Until then, leave it unset.
- Optional: `AUTO_VERIFY_PHONE_ON_EMAIL=1` will stamp `phoneVerifiedAt` when a user confirms their email code.
- The custom sign-in page at `/auth/signin` lets legacy users request a fresh verification code via `/api/auth/resend-verification` if they never received one.
- Email delivery uses [Resend](https://resend.com/). Configure `RESEND_API_KEY` and `MAIL_FROM_ADDRESS` (must be a verified sender) in production. Without those env vars the app simply logs the verification payload to the server console.
- For manual smoke tests, set `ENABLE_EMAIL_TESTER=1`. This enables `/api/debug/send-test-email` and a “Send test email” helper on the verification screen so you can confirm deliveries with the same Resend logic.
- Manage domains quickly with `npm run resend:domains <action>`. Actions: `create <domain>`, `list`, `get <id>`, `verify <id>`, `update <id> [--open-tracking=false --click-tracking=true]`, `remove <id>`. The command reads `RESEND_API_KEY` from your environment and surfaces Resend API errors in the console.

Branding suggestions
- Name: Philani Academy for Mathematics (use full name in headers; short form "Philani Academy" in the nav)
- Colors: Primary blue (#1D4ED8) and white accent for a clean educational look
- Logo: simple wordmark SVG is included at `public/logo.svg`. Replace with a designer artwork for production.
- Fonts: Use Inter or system-sans for modern legibility.
