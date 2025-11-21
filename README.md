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

Branding suggestions
- Name: Philani Academy for Mathematics (use full name in headers; short form "Philani Academy" in the nav)
- Colors: Primary blue (#1D4ED8) and white accent for a clean educational look
- Logo: simple wordmark SVG is included at `public/logo.svg`. Replace with a designer artwork for production.
- Fonts: Use Inter or system-sans for modern legibility.
