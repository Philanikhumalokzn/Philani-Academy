ALTER TABLE "LearnerResponse" DROP CONSTRAINT IF EXISTS "LearnerResponse_sessionKey_userId_key";
DROP INDEX IF EXISTS "LearnerResponse_sessionKey_userId_key";