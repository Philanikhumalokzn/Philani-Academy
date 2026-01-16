-- CreateTable
CREATE TABLE "ResourceBankItem" (
    "id" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "title" TEXT NOT NULL,
    "tag" TEXT,
    "url" TEXT NOT NULL,
    "filename" TEXT,
    "contentType" TEXT,
    "size" INTEGER,
    "checksum" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResourceBankItem_grade_createdAt_idx" ON "ResourceBankItem"("grade", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceBankItem_createdById_createdAt_idx" ON "ResourceBankItem"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceBankItem_grade_checksum_key" ON "ResourceBankItem"("grade", "checksum");

-- AddForeignKey
ALTER TABLE "ResourceBankItem" ADD CONSTRAINT "ResourceBankItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
