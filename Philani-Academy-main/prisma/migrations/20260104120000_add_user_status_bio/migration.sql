-- Add short status/bio to user profile (max 100 characters)
ALTER TABLE "User" ADD COLUMN "statusBio" VARCHAR(100);
