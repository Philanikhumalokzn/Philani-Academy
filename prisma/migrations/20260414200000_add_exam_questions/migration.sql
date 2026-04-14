-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "grade" "Grade" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "paper" INTEGER NOT NULL,
    "questionNumber" TEXT NOT NULL,
    "questionDepth" INTEGER NOT NULL DEFAULT 0,
    "topic" TEXT,
    "cognitiveLevel" INTEGER,
    "marks" INTEGER,
    "questionText" TEXT NOT NULL,
    "latex" TEXT,
    "imageUrl" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamQuestion_grade_year_month_paper_idx" ON "ExamQuestion"("grade", "year", "month", "paper");

-- CreateIndex
CREATE INDEX "ExamQuestion_topic_cognitiveLevel_idx" ON "ExamQuestion"("topic", "cognitiveLevel");

-- CreateIndex
CREATE INDEX "ExamQuestion_questionNumber_idx" ON "ExamQuestion"("questionNumber");

-- CreateIndex
CREATE INDEX "ExamQuestion_sourceId_idx" ON "ExamQuestion"("sourceId");

-- CreateIndex
CREATE INDEX "ExamQuestion_grade_approved_idx" ON "ExamQuestion"("grade", "approved");

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ResourceBankItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
