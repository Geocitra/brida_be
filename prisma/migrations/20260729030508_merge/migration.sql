-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "detected_districts" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "document_chunks_detected_districts_idx" ON "document_chunks" USING GIN ("detected_districts");
