-- Add editable marking plan fields to AssignmentSolution

ALTER TABLE "AssignmentSolution"
  ADD COLUMN IF NOT EXISTS "aiMarkingPlan" TEXT;

ALTER TABLE "AssignmentSolution"
  ADD COLUMN IF NOT EXISTS "teacherMarkingPlan" TEXT;
