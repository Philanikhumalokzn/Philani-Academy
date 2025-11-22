-- Create enum for verification kinds if it does not exist yet
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VerificationKind') THEN
        CREATE TYPE "VerificationKind" AS ENUM ('EMAIL', 'PHONE');
    END IF;
END
$$;

-- Create table to store verification tokens
CREATE TABLE IF NOT EXISTS "ContactVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "VerificationKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactVerification_pkey" PRIMARY KEY ("id")
);

-- Ensure token hashes remain unique
CREATE UNIQUE INDEX IF NOT EXISTS "ContactVerification_tokenHash_key"
  ON "ContactVerification" ("tokenHash");

-- Relationship to users
ALTER TABLE "ContactVerification"
  ADD CONSTRAINT "ContactVerification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
