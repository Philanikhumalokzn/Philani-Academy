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

Branding suggestions
- Name: Philani Academy for Mathematics (use full name in headers; short form "Philani Academy" in the nav)
- Colors: Primary blue (#1D4ED8) and white accent for a clean educational look
- Logo: simple wordmark SVG is included at `public/logo.svg`. Replace with a designer artwork for production.
- Fonts: Use Inter or system-sans for modern legibility.

## Profile enrichment (new)

The Profile page supports:

- Avatar: upload an image or capture via camera (stored in `public/avatars` in development).
- Bio, Race, and South African ID number (birth date is derived and validated).
- Multiple phone numbers with verification codes (provider-agnostic; integrate your own SMS provider).
- Teacher/Admin fields: title, subjects, experience, qualifications, website and socials, office hours.

Database changes add `PhoneNumber` and `TeacherProfile` models and extend the `User` model with `avatarUrl`, `bio`, `race`, `idNumber`, and `birthDate`.

Notes:

- In production on Vercel, writing to the filesystem is ephemeral. For avatars, integrate with an object store (e.g., Cloudinary, S3) and adjust `/api/profile/avatar`.
- Phone verification endpoints store hashed codes and expiry. When `DEBUG=1`, the start endpoint returns the code for testing. Hook up your SMS provider to actually send messages.

Migrations and Prisma:

```powershell
npm run prisma:migrate ; npm run prisma:generate
```

If you already have data, confirm new columns default to NULL and relations are optional.
