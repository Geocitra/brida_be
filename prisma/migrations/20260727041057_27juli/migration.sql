-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('MANUAL_INPUT', 'SUGGESTION_CHIP', 'SYSTEM_GENERATED');

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "interactionType" "InteractionType" NOT NULL DEFAULT 'MANUAL_INPUT',
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "runningSummary" TEXT;
