-- Add quiz context to learner responses so students can submit multiple quizzes per session.

ALTER TABLE "LearnerResponse"
ADD COLUMN IF NOT EXISTS "quizId" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN IF NOT EXISTS "prompt" TEXT;

-- Replace old uniqueness (sessionKey, userId) with (sessionKey, userId, quizId).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LearnerResponse_sessionKey_userId_key'
  ) THEN
    ALTER TABLE "LearnerResponse" DROP CONSTRAINT "LearnerResponse_sessionKey_userId_key";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LearnerResponse_sessionKey_userId_quizId_key'
  ) THEN
    ALTER TABLE "LearnerResponse"
    ADD CONSTRAINT "LearnerResponse_sessionKey_userId_quizId_key" UNIQUE ("sessionKey", "userId", "quizId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LearnerResponse_sessionKey_userId_updatedAt_idx"
ON "LearnerResponse" ("sessionKey", "userId", "updatedAt");
