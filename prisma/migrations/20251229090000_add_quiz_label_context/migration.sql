-- Add quiz labeling + lesson context to learner responses.

ALTER TABLE "LearnerResponse"
  ADD COLUMN IF NOT EXISTS "quizLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "quizPhaseKey" TEXT,
  ADD COLUMN IF NOT EXISTS "quizPointId" TEXT,
  ADD COLUMN IF NOT EXISTS "quizPointIndex" INTEGER;

-- Helpful index for listing/grouping quizzes.
CREATE INDEX IF NOT EXISTS "LearnerResponse_sessionKey_quizPhaseKey_quizPointIndex_updatedAt_idx"
  ON "LearnerResponse" ("sessionKey", "quizPhaseKey", "quizPointIndex", "updatedAt");
