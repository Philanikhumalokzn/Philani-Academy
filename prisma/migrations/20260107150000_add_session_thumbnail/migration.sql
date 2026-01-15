-- Add optional thumbnail to session lessons
ALTER TABLE "SessionRecord" ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;
