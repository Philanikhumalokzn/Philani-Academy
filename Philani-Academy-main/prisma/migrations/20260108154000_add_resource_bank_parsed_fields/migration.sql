-- Add parsed output fields for Resource Bank items.

ALTER TABLE "ResourceBankItem"
  ADD COLUMN IF NOT EXISTS "parsedJson" JSONB,
  ADD COLUMN IF NOT EXISTS "parsedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "parseError" TEXT;
