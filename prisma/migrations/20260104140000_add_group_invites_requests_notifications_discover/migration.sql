-- Add group join-request setting
ALTER TABLE "LearningGroup" ADD COLUMN IF NOT EXISTS "allowJoinRequests" BOOLEAN NOT NULL DEFAULT true;

-- Group invites
CREATE TABLE IF NOT EXISTS "GroupInvite" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "invitedUserId" TEXT NOT NULL,
  "invitedById" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "GroupInvite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GroupInvite" ADD CONSTRAINT "GroupInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LearningGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupInvite" ADD CONSTRAINT "GroupInvite_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupInvite" ADD CONSTRAINT "GroupInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "GroupInvite_groupId_invitedUserId_status_key" ON "GroupInvite"("groupId", "invitedUserId", "status");
CREATE INDEX IF NOT EXISTS "GroupInvite_invitedUserId_status_idx" ON "GroupInvite"("invitedUserId", "status");
CREATE INDEX IF NOT EXISTS "GroupInvite_groupId_status_idx" ON "GroupInvite"("groupId", "status");

-- Group join requests
CREATE TABLE IF NOT EXISTS "GroupJoinRequest" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "GroupJoinRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GroupJoinRequest" ADD CONSTRAINT "GroupJoinRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LearningGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupJoinRequest" ADD CONSTRAINT "GroupJoinRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "GroupJoinRequest_groupId_requestedById_status_key" ON "GroupJoinRequest"("groupId", "requestedById", "status");
CREATE INDEX IF NOT EXISTS "GroupJoinRequest_requestedById_status_idx" ON "GroupJoinRequest"("requestedById", "status");
CREATE INDEX IF NOT EXISTS "GroupJoinRequest_groupId_status_idx" ON "GroupJoinRequest"("groupId", "status");

-- Notifications (simple inbox)
CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT,
  "body" TEXT,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
