-- Store instructor solutions per assignment question.
-- These solutions are used later as the source-of-truth for Gemini grading.

CREATE TABLE IF NOT EXISTS "AssignmentSolution" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,

  "latex" TEXT,
  "fileUrl" TEXT,
  "fileName" TEXT,
  "contentType" TEXT,
  "size" INTEGER,

  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssignmentSolution_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AssignmentSolution"
  ADD CONSTRAINT "AssignmentSolution_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "SessionRecord"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentSolution"
  ADD CONSTRAINT "AssignmentSolution_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentSolution"
  ADD CONSTRAINT "AssignmentSolution_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "AssignmentQuestion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentSolution_questionId_key" ON "AssignmentSolution"("questionId");
CREATE INDEX IF NOT EXISTS "AssignmentSolution_assignmentId_idx" ON "AssignmentSolution"("assignmentId");
CREATE INDEX IF NOT EXISTS "AssignmentSolution_sessionId_idx" ON "AssignmentSolution"("sessionId");
CREATE INDEX IF NOT EXISTS "AssignmentSolution_assignmentId_updatedAt_idx" ON "AssignmentSolution"("assignmentId", "updatedAt");
