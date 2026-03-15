-- Add standalone social posts for non-lesson, non-challenge feed content.

CREATE TABLE "SocialPost" (
  "id" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "prompt" TEXT NOT NULL,
  "imageUrl" TEXT,
  "grade" "Grade",
  "audience" TEXT NOT NULL DEFAULT 'public',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SocialPost"
ADD CONSTRAINT "SocialPost_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "SocialPost_createdById_createdAt_idx" ON "SocialPost"("createdById", "createdAt");
CREATE INDEX "SocialPost_grade_createdAt_idx" ON "SocialPost"("grade", "createdAt");
CREATE INDEX "SocialPost_audience_createdAt_idx" ON "SocialPost"("audience", "createdAt");