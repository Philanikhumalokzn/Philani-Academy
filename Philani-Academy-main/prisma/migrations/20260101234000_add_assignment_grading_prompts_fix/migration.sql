-- Add grading prompts for AI grading guidance

ALTER TABLE "Assignment"
ADD COLUMN IF NOT EXISTS "gradingPrompt" TEXT;

ALTER TABLE "AssignmentQuestion"
ADD COLUMN IF NOT EXISTS "gradingPrompt" TEXT;
