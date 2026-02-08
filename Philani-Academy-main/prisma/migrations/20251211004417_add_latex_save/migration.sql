-- DropIndex
DROP INDEX "LessonMaterial_sessionId_idx";

-- AlterTable
ALTER TABLE "SubscriptionPlan" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "LatexSave" (
    "id" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "title" TEXT NOT NULL,
    "latex" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "filename" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LatexSave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LatexSave_sessionKey_idx" ON "LatexSave"("sessionKey");

-- CreateIndex
CREATE INDEX "LatexSave_sessionKey_userId_idx" ON "LatexSave"("sessionKey", "userId");
