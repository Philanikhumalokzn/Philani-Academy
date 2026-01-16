-- DropIndex
DROP INDEX "SessionRecord_grade_startsAt_endsAt_idx";

-- AlterTable
ALTER TABLE "AppSetting" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Diagram" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DiagramSessionState" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserSubscription" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonPhase" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "diagramIds" TEXT[],

    CONSTRAINT "LessonPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonStep" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "diagramId" TEXT,
    "replayEvents" JSONB,

    CONSTRAINT "LessonStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Homework" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "aiFeedback" BOOLEAN NOT NULL DEFAULT false,
    "scriptedAnswers" JSONB,

    CONSTRAINT "Homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_HomeworkQuestions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_HomeworkQuestions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Homework_lessonId_key" ON "Homework"("lessonId");

-- CreateIndex
CREATE INDEX "_HomeworkQuestions_B_index" ON "_HomeworkQuestions"("B");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPhase" ADD CONSTRAINT "LessonPhase_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonStep" ADD CONSTRAINT "LessonStep_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "LessonPhase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_HomeworkQuestions" ADD CONSTRAINT "_HomeworkQuestions_A_fkey" FOREIGN KEY ("A") REFERENCES "Homework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_HomeworkQuestions" ADD CONSTRAINT "_HomeworkQuestions_B_fkey" FOREIGN KEY ("B") REFERENCES "LessonStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
