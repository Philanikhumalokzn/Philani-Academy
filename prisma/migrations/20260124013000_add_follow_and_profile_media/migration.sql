-- Add follow graph + profile media fields.
-- This migration is written to be safe to apply even if the DB was previously synced via `prisma db push`.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileCoverUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileThemeBgUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "discoverabilityScope" TEXT NOT NULL DEFAULT 'grade';

CREATE TABLE IF NOT EXISTS "UserFollow" (
  "id" TEXT NOT NULL,
  "followerId" TEXT NOT NULL,
  "followingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserFollow_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserFollow_followerId_fkey'
  ) THEN
    ALTER TABLE "UserFollow"
      ADD CONSTRAINT "UserFollow_followerId_fkey" FOREIGN KEY ("followerId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserFollow_followingId_fkey'
  ) THEN
    ALTER TABLE "UserFollow"
      ADD CONSTRAINT "UserFollow_followingId_fkey" FOREIGN KEY ("followingId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserFollow_followerId_followingId_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'UserFollow_followerId_followingId_key'
  ) THEN
    ALTER TABLE "UserFollow"
      ADD CONSTRAINT "UserFollow_followerId_followingId_key" UNIQUE ("followerId", "followingId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "UserFollow_followerId_createdAt_idx" ON "UserFollow" ("followerId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserFollow_followingId_createdAt_idx" ON "UserFollow" ("followingId", "createdAt");
