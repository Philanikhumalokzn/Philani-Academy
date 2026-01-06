-- Add owner-controlled attempt visibility fields for learner-created challenges

ALTER TABLE "UserChallenge"
ADD COLUMN "attemptsOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "solutionsVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "revealedAt" TIMESTAMP(3);
