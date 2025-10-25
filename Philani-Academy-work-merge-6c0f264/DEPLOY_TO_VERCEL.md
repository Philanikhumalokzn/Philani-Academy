Deployment guide — Vercel + Postgres (Supabase) for Philani Academy

This guide walks through deploying the app to Vercel with a managed Postgres DB (Supabase). It can't be executed fully by the repo alone — you'll need to create accounts and provide credentials. Follow these steps from your machine.

1) Push repository to GitHub
- Create a repository and push all project files.

2) Create a Postgres database (Supabase example)
- Go to https://app.supabase.com and create a new project.
- In Project Settings → Database → Connection string copy the connection URL. It looks like:
  postgres://<user>:<password>@<host>:5432/<db>?schema=public

3) Configure Vercel project
- Go to https://vercel.com and import the GitHub repo.
- In Project Settings → Environment Variables, add the following for Production (and Preview if desired):
  - DATABASE_URL = <your Supabase/Postgres connection string>
  - NEXTAUTH_URL = https://<your-vercel-app>.vercel.app
  - NEXTAUTH_SECRET = <random 32-byte hex or base64 string>
  - STRIPE_SECRET_KEY = <if using Stripe>
  - STRIPE_PUBLISHABLE_KEY = <if using Stripe>
  If you use PayFast instead of Stripe (supported in South Africa), set these:

  - PAYFAST_MERCHANT_ID = <your_payfast_merchant_id>
  - PAYFAST_MERCHANT_KEY = <your_payfast_merchant_key>
  - PAYFAST_PASSPHRASE = <optional_passphrase_for_signature>

4) Migrate DB and seed admin
- On your machine, set DATABASE_URL to the hosted database then run migrations and seed:

PowerShell:

$env:DATABASE_URL = 'postgres://...'
$env:NODE_ENV = 'production'
npx prisma migrate deploy
node scripts/create_admin.js

This runs migrations against the hosted DB and creates an admin user.

5) Trigger a Vercel deployment
- Vercel will build on push. Once the build completes, open your app URL.

Notes and troubleshooting
- Make sure `prisma/schema.prisma` uses `provider = "postgresql"` in production or uses the same schema; Prisma Client will be generated during Vercel build if configured.
- If you use environment variables in build time, set them in Vercel for the Build step too.
- For support connecting to Supabase from Vercel, ensure the DB allows connections from Vercel's IPs (Supabase generally supports this).

Security
- Never commit secrets to the repo.
- After seeding the admin, rotate the seeded password.

If you want, I can:
- Add a `scripts/deploy-vercel.ps1` helper (it will only print commands to run locally).
- Add a `prisma` preview configuration for Postgres.

Tell me which extras to add and I will create them in the repo.