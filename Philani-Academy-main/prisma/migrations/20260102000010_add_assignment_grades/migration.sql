-- Add AssignmentGrade for AI grading results

CREATE TABLE IF NOT EXISTS "AssignmentGrade" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "results" JSONB NOT NULL,
  "earnedPoints" INTEGER NOT NULL,
  "totalPoints" INTEGER NOT NULL,
  "percentage" DOUBLE PRECISION NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'gemini',
  "model" TEXT,
  "gradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentGrade_pkey" PRIMARY KEY ("id")
);

-- Unique grade per learner per assignment
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentGrade_assignmentId_userId_key" ON "AssignmentGrade"("assignmentId", "userId");

CREATE INDEX IF NOT EXISTS "AssignmentGrade_sessionId_idx" ON "AssignmentGrade"("sessionId");
CREATE INDEX IF NOT EXISTS "AssignmentGrade_assignmentId_idx" ON "AssignmentGrade"("assignmentId");
CREATE INDEX IF NOT EXISTS "AssignmentGrade_userId_idx" ON "AssignmentGrade"("userId");
CREATE INDEX IF NOT EXISTS "AssignmentGrade_assignmentId_gradedAt_idx" ON "AssignmentGrade"("assignmentId", "gradedAt");

ALTER TABLE "AssignmentGrade"
ADD CONSTRAINT "AssignmentGrade_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentGrade"
ADD CONSTRAINT "AssignmentGrade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentGrade"
ADD CONSTRAINT "AssignmentGrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
