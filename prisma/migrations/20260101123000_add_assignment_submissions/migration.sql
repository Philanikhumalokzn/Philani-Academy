-- Final assignment submission marker.
-- Once a learner submits an assignment, editing is locked (enforced in API + UI).

CREATE TABLE IF NOT EXISTS "AssignmentSubmission" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AssignmentSubmission"
  ADD CONSTRAINT "AssignmentSubmission_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "SessionRecord"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentSubmission"
  ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentSubmission"
  ADD CONSTRAINT "AssignmentSubmission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentSubmission_assignmentId_userId_key" ON "AssignmentSubmission"("assignmentId", "userId");
CREATE INDEX IF NOT EXISTS "AssignmentSubmission_sessionId_idx" ON "AssignmentSubmission"("sessionId");
CREATE INDEX IF NOT EXISTS "AssignmentSubmission_assignmentId_submittedAt_idx" ON "AssignmentSubmission"("assignmentId", "submittedAt");
CREATE INDEX IF NOT EXISTS "AssignmentSubmission_userId_submittedAt_idx" ON "AssignmentSubmission"("userId", "submittedAt");
