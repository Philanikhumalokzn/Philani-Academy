-- Add jitsiActive column to SessionRecord
ALTER TABLE "SessionRecord" ADD COLUMN IF NOT EXISTS "jitsiActive" boolean DEFAULT false;