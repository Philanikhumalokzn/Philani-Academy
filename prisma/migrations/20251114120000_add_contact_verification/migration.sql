-- Add contact verification timestamps to enforce verified logins
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3);
