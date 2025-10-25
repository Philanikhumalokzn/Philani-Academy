-- Add jitsiPassword column to SessionRecord
ALTER TABLE "SessionRecord"
ADD COLUMN IF NOT EXISTS "jitsiPassword" text;
