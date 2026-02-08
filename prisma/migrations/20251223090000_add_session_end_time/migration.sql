-- Add endsAt to SessionRecord and backfill existing rows (assume 60 minutes duration)

ALTER TABLE "SessionRecord" ADD COLUMN "endsAt" TIMESTAMP(3);

UPDATE "SessionRecord"
SET "endsAt" = "startsAt" + INTERVAL '60 minutes'
WHERE "endsAt" IS NULL;

ALTER TABLE "SessionRecord" ALTER COLUMN "endsAt" SET NOT NULL;

-- Index to support time-window queries
CREATE INDEX "SessionRecord_grade_startsAt_endsAt_idx" ON "SessionRecord"("grade", "startsAt", "endsAt");
