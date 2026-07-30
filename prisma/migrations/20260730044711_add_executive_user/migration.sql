-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "district_density" JSONB DEFAULT '{}';

-- CreateTable
CREATE TABLE "executive_users" (
    "id" UUID NOT NULL,
    "nip" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "executive_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "executive_users_nip_key" ON "executive_users"("nip");
