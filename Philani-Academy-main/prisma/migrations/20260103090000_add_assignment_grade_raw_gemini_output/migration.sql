-- Persist raw Gemini output for admin inspection

ALTER TABLE "AssignmentGrade"
ADD COLUMN IF NOT EXISTS "rawGeminiOutput" TEXT;
