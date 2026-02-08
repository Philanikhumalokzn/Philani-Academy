-- Add grading JSON + feedback to learner responses.

ALTER TABLE "LearnerResponse" ADD COLUMN "gradingJson" JSONB;
ALTER TABLE "LearnerResponse" ADD COLUMN "feedback" TEXT;
