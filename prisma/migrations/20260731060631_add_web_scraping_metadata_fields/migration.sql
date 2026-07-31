-- AlterTable
ALTER TABLE "document_metadata" ADD COLUMN     "external_metadata" JSONB DEFAULT '{}',
ADD COLUMN     "source_url" VARCHAR(2048);
