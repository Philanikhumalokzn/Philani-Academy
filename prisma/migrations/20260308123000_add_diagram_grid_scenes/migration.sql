ALTER TABLE "Diagram" ADD COLUMN "gridScene" JSONB;
ALTER TABLE "Diagram" ADD COLUMN "gridSceneUpdatedAt" TIMESTAMP(3);

CREATE TABLE "DiagramSceneSnapshot" (
  "id" TEXT NOT NULL,
  "diagramId" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scene" JSONB NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiagramSceneSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiagramSceneSnapshot_diagramId_updatedAt_idx" ON "DiagramSceneSnapshot"("diagramId", "updatedAt");
CREATE INDEX "DiagramSceneSnapshot_sessionKey_updatedAt_idx" ON "DiagramSceneSnapshot"("sessionKey", "updatedAt");

ALTER TABLE "DiagramSceneSnapshot"
ADD CONSTRAINT "DiagramSceneSnapshot_diagramId_fkey"
FOREIGN KEY ("diagramId") REFERENCES "Diagram"("id")
ON DELETE CASCADE ON UPDATE CASCADE;