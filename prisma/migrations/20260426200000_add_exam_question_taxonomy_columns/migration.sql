-- Add taxonomy columns to ExamQuestion (idempotent)
ALTER TABLE "ExamQuestion"
  ADD COLUMN IF NOT EXISTS "paperMode"          "PaperMode",
  ADD COLUMN IF NOT EXISTS "paperLabelRaw"      TEXT,
  ADD COLUMN IF NOT EXISTS "sourceName"         TEXT,
  ADD COLUMN IF NOT EXISTS "authorityScope"     "AuthorityScope",
  ADD COLUMN IF NOT EXISTS "province"           TEXT,
  ADD COLUMN IF NOT EXISTS "examCycle"          "ExamCycle",
  ADD COLUMN IF NOT EXISTS "assessmentType"     "AssessmentType",
  ADD COLUMN IF NOT EXISTS "assessmentFormality" "AssessmentFormality";

-- Ensure expected indexes exist
CREATE INDEX IF NOT EXISTS "ExamQuestion_grade_year_month_paperMode_idx"
  ON "ExamQuestion" ("grade", "year", "month", "paperMode");

CREATE INDEX IF NOT EXISTS "ExamQuestion_authorityScope_province_examCycle_idx"
  ON "ExamQuestion" ("authorityScope", "province", "examCycle");
