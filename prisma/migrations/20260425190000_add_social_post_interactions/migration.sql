-- Persist likes and share events for social posts.

CREATE TYPE "SocialPostInteractionKind" AS ENUM ('LIKE', 'SHARE');

CREATE TABLE "SocialPostInteraction" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "SocialPostInteractionKind" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SocialPostInteraction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SocialPostInteraction"
ADD CONSTRAINT "SocialPostInteraction_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "SocialPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPostInteraction"
ADD CONSTRAINT "SocialPostInteraction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SocialPostInteraction_postId_userId_kind_key" ON "SocialPostInteraction"("postId", "userId", "kind");
CREATE INDEX "SocialPostInteraction_postId_kind_createdAt_idx" ON "SocialPostInteraction"("postId", "kind", "createdAt");
CREATE INDEX "SocialPostInteraction_userId_kind_createdAt_idx" ON "SocialPostInteraction"("userId", "kind", "createdAt");
