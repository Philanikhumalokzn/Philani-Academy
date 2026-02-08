-- Baseline creation for LearnerResponse.
--
-- Why: this table existed in some environments due to `prisma db push`,
-- but the migration history alters it later. Prisma's shadow database
-- applies migrations from scratch and fails if the table doesn't exist.

CREATE TABLE IF NOT EXISTS "LearnerResponse" (
  "id" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userEmail" TEXT,
  "latex" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LearnerResponse_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LearnerResponse_userId_fkey'
  ) THEN
    ALTER TABLE "LearnerResponse"
      ADD CONSTRAINT "LearnerResponse_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Historical uniqueness (sessionKey, userId). Later migrations may replace it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LearnerResponse_sessionKey_userId_key'
  ) THEN
    ALTER TABLE "LearnerResponse"
      ADD CONSTRAINT "LearnerResponse_sessionKey_userId_key" UNIQUE ("sessionKey", "userId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LearnerResponse_sessionKey_idx" ON "LearnerResponse" ("sessionKey");
