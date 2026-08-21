-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "editorDocumentState" TEXT,
ADD COLUMN     "parentSessionId" UUID;

-- CreateTable
CREATE TABLE "session_media_assets" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_media_assets_sessionId_idx" ON "session_media_assets"("sessionId");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_media_assets" ADD CONSTRAINT "session_media_assets_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
