-- Add assignments (imported from PDF/screenshot) and per-assignment questions.

CREATE TABLE IF NOT EXISTS "Assignment" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "sourceContentType" TEXT,
  "sourceFilename" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "SessionRecord"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Assignment_sessionId_idx" ON "Assignment"("sessionId");
CREATE INDEX IF NOT EXISTS "Assignment_sessionId_createdAt_idx" ON "Assignment"("sessionId", "createdAt");


CREATE TABLE IF NOT EXISTS "AssignmentQuestion" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "latex" TEXT NOT NULL,
  "points" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssignmentQuestion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AssignmentQuestion"
  ADD CONSTRAINT "AssignmentQuestion_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentQuestion_assignmentId_order_key" ON "AssignmentQuestion"("assignmentId", "order");
CREATE INDEX IF NOT EXISTS "AssignmentQuestion_assignmentId_order_idx" ON "AssignmentQuestion"("assignmentId", "order");
