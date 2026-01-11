-- Add optional noteId and rich payload storage for Notes.

ALTER TABLE "LatexSave" ADD COLUMN "noteId" TEXT;
ALTER TABLE "LatexSave" ADD COLUMN "payload" JSONB;

CREATE INDEX "LatexSave_sessionKey_noteId_idx" ON "LatexSave"("sessionKey", "noteId");
