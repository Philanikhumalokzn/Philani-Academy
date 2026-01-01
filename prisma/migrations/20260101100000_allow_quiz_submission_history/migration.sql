-- Allow multiple quiz submissions per student per quiz so the dashboard can show history.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LearnerResponse_sessionKey_userId_quizId_key'
  ) THEN
    ALTER TABLE "LearnerResponse" DROP CONSTRAINT "LearnerResponse_sessionKey_userId_quizId_key";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LearnerResponse_sessionKey_userId_quizId_createdAt_idx"
ON "LearnerResponse" ("sessionKey", "userId", "quizId", "createdAt");
