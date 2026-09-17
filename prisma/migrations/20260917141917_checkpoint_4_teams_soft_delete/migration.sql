-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "teams_deletedAt_idx" ON "teams"("deletedAt");
