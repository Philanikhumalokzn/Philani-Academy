CREATE TABLE "QuestionRemix" (
  "id" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "grade" "Grade",
  "audience" TEXT NOT NULL DEFAULT 'private',
  "inviteNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuestionRemix_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionRemixQuestion" (
  "remixId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuestionRemixQuestion_pkey" PRIMARY KEY ("remixId", "questionId")
);

CREATE TABLE "QuestionRemixUser" (
  "remixId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuestionRemixUser_pkey" PRIMARY KEY ("remixId", "userId")
);

CREATE TABLE "QuestionRemixGroup" (
  "remixId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuestionRemixGroup_pkey" PRIMARY KEY ("remixId", "groupId")
);

ALTER TABLE "QuestionRemix"
ADD CONSTRAINT "QuestionRemix_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionRemixQuestion"
ADD CONSTRAINT "QuestionRemixQuestion_remixId_fkey"
FOREIGN KEY ("remixId") REFERENCES "QuestionRemix"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionRemixQuestion"
ADD CONSTRAINT "QuestionRemixQuestion_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "ExamQuestion"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionRemixUser"
ADD CONSTRAINT "QuestionRemixUser_remixId_fkey"
FOREIGN KEY ("remixId") REFERENCES "QuestionRemix"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionRemixUser"
ADD CONSTRAINT "QuestionRemixUser_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionRemixGroup"
ADD CONSTRAINT "QuestionRemixGroup_remixId_fkey"
FOREIGN KEY ("remixId") REFERENCES "QuestionRemix"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionRemixGroup"
ADD CONSTRAINT "QuestionRemixGroup_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "LearningGroup"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "QuestionRemix_createdById_createdAt_idx" ON "QuestionRemix"("createdById", "createdAt");
CREATE INDEX "QuestionRemix_audience_createdAt_idx" ON "QuestionRemix"("audience", "createdAt");
CREATE INDEX "QuestionRemix_grade_createdAt_idx" ON "QuestionRemix"("grade", "createdAt");
CREATE INDEX "QuestionRemixQuestion_questionId_idx" ON "QuestionRemixQuestion"("questionId");
CREATE INDEX "QuestionRemixQuestion_remixId_orderIndex_idx" ON "QuestionRemixQuestion"("remixId", "orderIndex");
CREATE INDEX "QuestionRemixUser_userId_idx" ON "QuestionRemixUser"("userId");
CREATE INDEX "QuestionRemixGroup_groupId_idx" ON "QuestionRemixGroup"("groupId");