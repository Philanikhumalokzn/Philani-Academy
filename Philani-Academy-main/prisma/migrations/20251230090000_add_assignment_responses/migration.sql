-- Store learner responses per assignment question (separate from quizzes).

CREATE TABLE IF NOT EXISTS "AssignmentResponse" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userEmail" TEXT,
  "latex" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssignmentResponse_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AssignmentResponse"
  ADD CONSTRAINT "AssignmentResponse_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentResponse"
  ADD CONSTRAINT "AssignmentResponse_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "AssignmentQuestion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentResponse"
  ADD CONSTRAINT "AssignmentResponse_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentResponse_questionId_userId_key" ON "AssignmentResponse"("questionId", "userId");
CREATE INDEX IF NOT EXISTS "AssignmentResponse_sessionId_idx" ON "AssignmentResponse"("sessionId");
CREATE INDEX IF NOT EXISTS "AssignmentResponse_assignmentId_userId_updatedAt_idx" ON "AssignmentResponse"("assignmentId", "userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "AssignmentResponse_questionId_updatedAt_idx" ON "AssignmentResponse"("questionId", "updatedAt");
