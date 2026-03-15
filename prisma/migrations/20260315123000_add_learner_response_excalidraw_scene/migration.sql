-- Add Excalidraw scene storage to learner responses.

ALTER TABLE "LearnerResponse" ADD COLUMN "excalidrawScene" JSONB;