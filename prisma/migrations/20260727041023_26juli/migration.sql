-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('QA_CHAT', 'ARTICLE_GENERATOR');

-- CreateEnum
CREATE TYPE "ArticleLength" AS ENUM ('SHORT', 'MEDIUM', 'LONG');

-- CreateTable
CREATE TABLE "report_documents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksumHash" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_metadata" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "totalTokenCount" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'General Report',
    "uploadedBy" TEXT NOT NULL DEFAULT 'SYSTEM_STAF',
    "docType" TEXT NOT NULL DEFAULT 'REALIZATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "rawText" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_logs" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "status" "LogStatus" NOT NULL DEFAULT 'INFO',
    "errorMessage" TEXT,
    "executionTimeMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geospatial_locations" (
    "id" UUID NOT NULL,
    "chunkId" UUID NOT NULL,
    "locationName" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geospatial_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analysis_logs" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "userQuery" TEXT NOT NULL,
    "status" "LogStatus" NOT NULL DEFAULT 'SUCCESS',
    "executionTimeMs" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "responsePayload" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analysis_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "documentId" UUID,
    "sessionType" "SessionType" NOT NULL DEFAULT 'QA_CHAT',
    "title" TEXT NOT NULL DEFAULT 'Sesi Analisis Kasus',
    "articleTitle" TEXT,
    "targetLength" "ArticleLength" DEFAULT 'MEDIUM',
    "tone" TEXT DEFAULT 'solutif',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_session_source_refs" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_session_source_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_reports" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "reportType" TEXT NOT NULL DEFAULT 'NOTA_DINAS_BUPATI',
    "documentIdsHash" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "contentPayload" JSONB NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "llmProvider" TEXT NOT NULL DEFAULT 'GEMINI_FLASH',
    "status" "DocumentStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_source_refs" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_source_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_baselines" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "indicator_name" TEXT NOT NULL,
    "target_value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'M',
    "timeframe" TEXT NOT NULL DEFAULT '2026',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicator_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_realizations" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "indicator_name" TEXT NOT NULL,
    "realization_value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'M',
    "timeframe" TEXT NOT NULL DEFAULT '2026',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicator_realizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deviation_analyses" (
    "id" UUID NOT NULL,
    "baseline_doc_id" UUID,
    "realization_doc_id" UUID,
    "indicator_name" TEXT NOT NULL,
    "target_value" DOUBLE PRECISION NOT NULL,
    "realization_value" DOUBLE PRECISION NOT NULL,
    "deviation_value" DOUBLE PRECISION NOT NULL,
    "deviation_percentage" DOUBLE PRECISION NOT NULL,
    "urgency_status" TEXT NOT NULL,
    "causal_factors" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deviation_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_documents_checksumHash_key" ON "report_documents"("checksumHash");

-- CreateIndex
CREATE UNIQUE INDEX "document_metadata_documentId_key" ON "document_metadata"("documentId");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_chunkIndex_idx" ON "document_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "chat_session_source_refs_sessionId_documentId_key" ON "chat_session_source_refs"("sessionId", "documentId");

-- CreateIndex
CREATE INDEX "chat_messages_sessionId_createdAt_idx" ON "chat_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "generated_reports_documentIdsHash_idx" ON "generated_reports"("documentIdsHash");

-- CreateIndex
CREATE UNIQUE INDEX "report_source_refs_reportId_documentId_key" ON "report_source_refs"("reportId", "documentId");

-- AddForeignKey
ALTER TABLE "document_metadata" ADD CONSTRAINT "document_metadata_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_logs" ADD CONSTRAINT "extraction_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geospatial_locations" ADD CONSTRAINT "geospatial_locations_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "document_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_logs" ADD CONSTRAINT "ai_analysis_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_session_source_refs" ADD CONSTRAINT "chat_session_source_refs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_session_source_refs" ADD CONSTRAINT "chat_session_source_refs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_source_refs" ADD CONSTRAINT "report_source_refs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "generated_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_source_refs" ADD CONSTRAINT "report_source_refs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_baselines" ADD CONSTRAINT "indicator_baselines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_realizations" ADD CONSTRAINT "indicator_realizations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "report_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
