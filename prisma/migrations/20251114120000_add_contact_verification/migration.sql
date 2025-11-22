-- CreateEnum
CREATE TYPE "ContactVerificationType" AS ENUM ('EMAIL', 'PHONE');

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ContactVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ContactVerificationType" NOT NULL,
    "channelAddress" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactVerification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContactVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ContactVerification_userId_type_idx" ON "ContactVerification"("userId", "type");
CREATE INDEX "ContactVerification_channel_type_idx" ON "ContactVerification"("channelAddress", "type");
