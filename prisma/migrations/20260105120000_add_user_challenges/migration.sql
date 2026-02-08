-- Add user-posted profile timeline challenges/quizzes

CREATE TABLE "UserChallenge" (
  "id" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "prompt" TEXT NOT NULL,
  "imageUrl" TEXT,
  "grade" "Grade",
  "audience" TEXT NOT NULL DEFAULT 'public',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserChallenge_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UserChallenge" ADD CONSTRAINT "UserChallenge_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "UserChallenge_createdById_createdAt_idx" ON "UserChallenge"("createdById", "createdAt");
CREATE INDEX "UserChallenge_grade_createdAt_idx" ON "UserChallenge"("grade", "createdAt");
CREATE INDEX "UserChallenge_audience_createdAt_idx" ON "UserChallenge"("audience", "createdAt");
