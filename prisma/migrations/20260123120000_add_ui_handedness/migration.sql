-- Add UI handedness preference for one-handed ergonomics
ALTER TABLE "User" ADD COLUMN "uiHandedness" TEXT NOT NULL DEFAULT 'right';
