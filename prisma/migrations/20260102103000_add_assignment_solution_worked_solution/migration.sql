-- Add editable worked solution fields to AssignmentSolution

ALTER TABLE "AssignmentSolution"
  ADD COLUMN IF NOT EXISTS "aiWorkedSolution" TEXT;

ALTER TABLE "AssignmentSolution"
  ADD COLUMN IF NOT EXISTS "teacherWorkedSolution" TEXT;
