-- AlterTable
ALTER TABLE "ResourceBankItem" ADD COLUMN "parsedJson" JSONB;
ALTER TABLE "ResourceBankItem" ADD COLUMN "parsedAt" TIMESTAMP(3);
ALTER TABLE "ResourceBankItem" ADD COLUMN "parseError" TEXT;
