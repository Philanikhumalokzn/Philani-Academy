-- User-level profile visibility ("shared" or "private")
ALTER TABLE "User" ADD COLUMN "profileVisibility" TEXT NOT NULL DEFAULT 'shared';

-- Learning groups (classes, cohorts, study groups)
CREATE TABLE "LearningGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "grade" "Grade",
  "createdById" TEXT,
  "joinCode" TEXT NOT NULL,
  "joinCodeActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LearningGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningGroup_joinCode_key" ON "LearningGroup"("joinCode");
CREATE INDEX "LearningGroup_grade_idx" ON "LearningGroup"("grade");
CREATE INDEX "LearningGroup_createdById_idx" ON "LearningGroup"("createdById");

ALTER TABLE "LearningGroup" ADD CONSTRAINT "LearningGroup_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Memberships
CREATE TABLE "LearningGroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberRole" TEXT NOT NULL DEFAULT 'member',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LearningGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningGroupMember_groupId_userId_key" ON "LearningGroupMember"("groupId", "userId");
CREATE INDEX "LearningGroupMember_userId_idx" ON "LearningGroupMember"("userId");
CREATE INDEX "LearningGroupMember_groupId_idx" ON "LearningGroupMember"("groupId");

ALTER TABLE "LearningGroupMember" ADD CONSTRAINT "LearningGroupMember_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "LearningGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningGroupMember" ADD CONSTRAINT "LearningGroupMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
