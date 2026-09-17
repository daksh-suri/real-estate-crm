-- CreateEnum
CREATE TYPE "CommunicationConsent" AS ENUM ('OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "PossibleDuplicateStatus" AS ENUM ('PENDING', 'CONFIRMED_SAME', 'CONFIRMED_DIFFERENT');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "email" TEXT,
    "normalizedEmail" TEXT,
    "communicationConsent" "CommunicationConsent" NOT NULL DEFAULT 'OPTED_IN',
    "consentUpdatedAt" TIMESTAMP(3),
    "consentSource" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "unitTypePreference" TEXT,
    "budgetMin" DECIMAL(15,2),
    "budgetMax" DECIMAL(15,2),
    "preferredProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "possessionPreference" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "possible_duplicates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactAId" TEXT NOT NULL,
    "contactBId" TEXT NOT NULL,
    "matchSignal" TEXT NOT NULL,
    "status" "PossibleDuplicateStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "possible_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_organizationId_idx" ON "contacts"("organizationId");

-- CreateIndex
CREATE INDEX "contacts_organizationId_normalizedEmail_idx" ON "contacts"("organizationId", "normalizedEmail");

-- CreateIndex
CREATE INDEX "contacts_organizationId_normalizedPhone_idx" ON "contacts"("organizationId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "contacts_deletedAt_idx" ON "contacts"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_organizationId_normalizedEmail_normalizedPhone_key" ON "contacts"("organizationId", "normalizedEmail", "normalizedPhone");

-- CreateIndex
CREATE INDEX "requirements_organizationId_idx" ON "requirements"("organizationId");

-- CreateIndex
CREATE INDEX "requirements_contactId_idx" ON "requirements"("contactId");

-- CreateIndex
CREATE INDEX "requirements_organizationId_contactId_idx" ON "requirements"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "requirements_deletedAt_idx" ON "requirements"("deletedAt");

-- CreateIndex
CREATE INDEX "possible_duplicates_organizationId_idx" ON "possible_duplicates"("organizationId");

-- CreateIndex
CREATE INDEX "possible_duplicates_contactAId_idx" ON "possible_duplicates"("contactAId");

-- CreateIndex
CREATE INDEX "possible_duplicates_contactBId_idx" ON "possible_duplicates"("contactBId");

-- CreateIndex
CREATE INDEX "possible_duplicates_status_idx" ON "possible_duplicates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "possible_duplicates_organizationId_contactAId_contactBId_key" ON "possible_duplicates"("organizationId", "contactAId", "contactBId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "possible_duplicates" ADD CONSTRAINT "possible_duplicates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "possible_duplicates" ADD CONSTRAINT "possible_duplicates_contactAId_fkey" FOREIGN KEY ("contactAId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "possible_duplicates" ADD CONSTRAINT "possible_duplicates_contactBId_fkey" FOREIGN KEY ("contactBId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
