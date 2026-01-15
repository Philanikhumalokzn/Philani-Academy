/*
  Warnings:

  - You are about to drop the `Homework` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Lesson` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LessonPhase` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LessonStep` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_HomeworkQuestions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Homework" DROP CONSTRAINT "Homework_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "Lesson" DROP CONSTRAINT "Lesson_authorId_fkey";

-- DropForeignKey
ALTER TABLE "LessonPhase" DROP CONSTRAINT "LessonPhase_lessonId_fkey";

-- DropForeignKey
ALTER TABLE "LessonStep" DROP CONSTRAINT "LessonStep_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "_HomeworkQuestions" DROP CONSTRAINT "_HomeworkQuestions_A_fkey";

-- DropForeignKey
ALTER TABLE "_HomeworkQuestions" DROP CONSTRAINT "_HomeworkQuestions_B_fkey";

-- DropTable
DROP TABLE "Homework";

-- DropTable
DROP TABLE "Lesson";

-- DropTable
DROP TABLE "LessonPhase";

-- DropTable
DROP TABLE "LessonStep";

-- DropTable
DROP TABLE "_HomeworkQuestions";

-- CreateTable
CREATE TABLE "LessonScriptTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "grade" "Grade",
    "subject" TEXT,
    "topic" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currentVersionId" TEXT,

    CONSTRAINT "LessonScriptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonScriptVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonScriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionLessonScript" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersionId" TEXT,
    "overrideContent" JSONB,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionLessonScript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonScriptTemplate_grade_idx" ON "LessonScriptTemplate"("grade");

-- CreateIndex
CREATE INDEX "LessonScriptVersion_templateId_idx" ON "LessonScriptVersion"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonScriptVersion_templateId_version_key" ON "LessonScriptVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SessionLessonScript_sessionId_key" ON "SessionLessonScript"("sessionId");

-- CreateIndex
CREATE INDEX "SessionLessonScript_templateId_idx" ON "SessionLessonScript"("templateId");

-- CreateIndex
CREATE INDEX "SessionLessonScript_templateVersionId_idx" ON "SessionLessonScript"("templateVersionId");

-- AddForeignKey
ALTER TABLE "LessonScriptTemplate" ADD CONSTRAINT "LessonScriptTemplate_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "LessonScriptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonScriptVersion" ADD CONSTRAINT "LessonScriptVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "LessonScriptTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionLessonScript" ADD CONSTRAINT "SessionLessonScript_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionLessonScript" ADD CONSTRAINT "SessionLessonScript_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "LessonScriptTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionLessonScript" ADD CONSTRAINT "SessionLessonScript_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "LessonScriptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
