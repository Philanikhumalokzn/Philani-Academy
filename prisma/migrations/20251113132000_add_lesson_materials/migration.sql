-- CreateTable
CREATE TABLE "LessonMaterial" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT,
    "size" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LessonMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonMaterial_sessionId_idx" ON "LessonMaterial"("sessionId");

-- AddForeignKey
ALTER TABLE "LessonMaterial"
ADD CONSTRAINT "LessonMaterial_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "SessionRecord"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
