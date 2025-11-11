-- Add grade column to SessionRecord; default 12 for existing rows
ALTER TABLE "SessionRecord" ADD COLUMN IF NOT EXISTS "grade" INTEGER NOT NULL DEFAULT 12;

-- Optional: constrain grade between 8 and 12
DO $$ BEGIN
  ALTER TABLE "SessionRecord"
  ADD CONSTRAINT "SessionRecord_grade_check" CHECK ("grade" >= 8 AND "grade" <= 12);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
