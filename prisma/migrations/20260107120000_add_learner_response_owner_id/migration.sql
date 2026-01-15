-- Associate quiz/challenge attempts with an owner (e.g., learner-created challenge author)

ALTER TABLE "LearnerResponse"
ADD COLUMN "ownerId" TEXT;

CREATE INDEX "LearnerResponse_sessionKey_ownerId_updatedAt_idx"
ON "LearnerResponse"("sessionKey", "ownerId", "updatedAt");
