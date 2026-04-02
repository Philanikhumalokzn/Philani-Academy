-- Allow social posts to carry challenge-style response controls.

ALTER TABLE "SocialPost"
ADD COLUMN "attemptsOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "solutionsVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "maxAttempts" INTEGER,
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "revealedAt" TIMESTAMP(3);