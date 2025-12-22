-- CreateTable
CREATE TABLE "Diagram" (
  "id" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "imageUrl" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "annotations" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Diagram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Diagram_sessionKey_idx" ON "Diagram"("sessionKey");

-- CreateTable
CREATE TABLE "DiagramSessionState" (
  "sessionKey" TEXT NOT NULL,
  "activeDiagramId" TEXT,
  "isOpen" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiagramSessionState_pkey" PRIMARY KEY ("sessionKey")
);
