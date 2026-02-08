-- CreateTable
CREATE TABLE "LearnerResponse" (
  "id" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userEmail" TEXT,
  "latex" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearnerResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearnerResponse_sessionKey_userId_key" ON "LearnerResponse"("sessionKey", "userId");
CREATE INDEX "LearnerResponse_sessionKey_idx" ON "LearnerResponse"("sessionKey");
CREATE INDEX "LearnerResponse_sessionKey_updatedAt_idx" ON "LearnerResponse"("sessionKey", "updatedAt");

ALTER TABLE "LearnerResponse"
  ADD CONSTRAINT "LearnerResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
