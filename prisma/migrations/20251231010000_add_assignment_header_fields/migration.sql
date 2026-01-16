-- Add stable, Gemini-decided header fields for assignments.

ALTER TABLE "Assignment"
  ADD COLUMN IF NOT EXISTS "displayTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "sectionLabel" TEXT;
