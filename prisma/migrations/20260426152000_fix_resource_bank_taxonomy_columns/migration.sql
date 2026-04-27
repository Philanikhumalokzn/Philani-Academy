-- Ensure taxonomy enums exist (idempotent)
DO $$
BEGIN
  CREATE TYPE "ExamCycle" AS ENUM ('FINAL', 'PRELIM', 'QUARTERLY', 'COMMON_TEST', 'SUPPLEMENTARY', 'INTERNAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PaperMode" AS ENUM ('P1', 'P2', 'P3', 'COMBINED', 'UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AuthorityScope" AS ENUM ('NATIONAL', 'PROVINCIAL', 'DISTRICT', 'SCHOOL', 'INTERNAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AssessmentType" AS ENUM ('EXAM', 'TEST', 'ASSIGNMENT', 'WORKSHEET', 'QUIZ', 'UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AssessmentFormality" AS ENUM ('FORMAL', 'INFORMAL', 'UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ensure ResourceBankItem has all schema fields (idempotent)
ALTER TABLE "ResourceBankItem"
  ADD COLUMN IF NOT EXISTS "sourceName" TEXT,
  ADD COLUMN IF NOT EXISTS "authorityScope" "AuthorityScope",
  ADD COLUMN IF NOT EXISTS "province" TEXT,
  ADD COLUMN IF NOT EXISTS "examCycle" "ExamCycle",
  ADD COLUMN IF NOT EXISTS "assessmentType" "AssessmentType",
  ADD COLUMN IF NOT EXISTS "assessmentFormality" "AssessmentFormality",
  ADD COLUMN IF NOT EXISTS "year" INTEGER,
  ADD COLUMN IF NOT EXISTS "sessionMonth" TEXT,
  ADD COLUMN IF NOT EXISTS "paper" INTEGER,
  ADD COLUMN IF NOT EXISTS "paperMode" "PaperMode",
  ADD COLUMN IF NOT EXISTS "paperLabelRaw" TEXT,
  ADD COLUMN IF NOT EXISTS "checksum" TEXT,
  ADD COLUMN IF NOT EXISTS "parsedJson" JSONB,
  ADD COLUMN IF NOT EXISTS "parsedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "parseError" TEXT;

-- Ensure expected indexes exist
CREATE INDEX IF NOT EXISTS "ResourceBankItem_grade_year_sessionMonth_paperMode_createdAt_idx"
  ON "ResourceBankItem" ("grade", "year", "sessionMonth", "paperMode", "createdAt");

CREATE INDEX IF NOT EXISTS "ResourceBankItem_grade_createdAt_idx"
  ON "ResourceBankItem" ("grade", "createdAt");

CREATE INDEX IF NOT EXISTS "ResourceBankItem_createdById_createdAt_idx"
  ON "ResourceBankItem" ("createdById", "createdAt");

-- Try to ensure checksum uniqueness; skip safely if existing data violates uniqueness.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "ResourceBankItem_grade_checksum_key"
    ON "ResourceBankItem" ("grade", "checksum");
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping unique index ResourceBankItem_grade_checksum_key due to existing data or compatibility: %', SQLERRM;
END $$;
