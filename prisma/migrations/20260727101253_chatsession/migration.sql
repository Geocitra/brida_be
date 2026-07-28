-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "parentSessionId" UUID;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
