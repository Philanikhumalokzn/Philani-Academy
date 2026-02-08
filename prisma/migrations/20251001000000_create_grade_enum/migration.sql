-- Baseline enum creation for Postgres.
--
-- Why: multiple early migrations reference the "Grade" enum type.
-- Some environments were created via db push, and some historical migrations
-- attempt to create the type inside a DO block without EXECUTE.
-- Creating it here first makes the rest of the migration chain apply cleanly
-- in a fresh/shadow database.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE LOWER(typname) = 'grade'
  ) THEN
    EXECUTE 'CREATE TYPE "Grade" AS ENUM (''GRADE_8'', ''GRADE_9'', ''GRADE_10'', ''GRADE_11'', ''GRADE_12'')';
  END IF;
END
$$;
