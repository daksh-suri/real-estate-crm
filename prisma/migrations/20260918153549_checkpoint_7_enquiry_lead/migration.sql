-- CreateEnum
CREATE TYPE "EnquiryChannel" AS ENUM ('PORTAL', 'WALK_IN', 'PHONE', 'OWNED_FORM');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('OPEN', 'CONVERTED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('MANUAL', 'AUTO', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "AssignmentRuleType" AS ENUM ('ROUND_ROBIN');

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leadSourceId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "EnquiryChannel" NOT NULL,
    "leadSourceId" TEXT,
    "campaignId" TEXT,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "contactId" TEXT,
    "projectId" TEXT,
    "linkedLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "projectId" TEXT,
    "requirementId" TEXT,
    "leadSourceId" TEXT,
    "campaignId" TEXT,
    "originEnquiryId" TEXT NOT NULL,
    "assignedAgentId" TEXT,
    "assignmentSource" "AssignmentSource" NOT NULL DEFAULT 'UNASSIGNED',
    "assignedAt" TIMESTAMP(3),
    "status" "LeadStatus" NOT NULL DEFAULT 'OPEN',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "AssignmentRuleType" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_robin_states" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "lastAssignedUserId" TEXT,
    "lastIndex" INTEGER NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "round_robin_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operationType" TEXT NOT NULL DEFAULT 'ENQUIRY_INTAKE',
    "requestHash" TEXT NOT NULL,
    "responseSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_sources_organizationId_idx" ON "lead_sources"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_organizationId_name_key" ON "lead_sources"("organizationId", "name");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_idx" ON "campaigns"("organizationId");

-- CreateIndex
CREATE INDEX "campaigns_leadSourceId_idx" ON "campaigns"("leadSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_organizationId_name_key" ON "campaigns"("organizationId", "name");

-- CreateIndex
CREATE INDEX "enquiries_organizationId_idx" ON "enquiries"("organizationId");

-- CreateIndex
CREATE INDEX "enquiries_organizationId_contactId_idx" ON "enquiries"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "enquiries_organizationId_projectId_idx" ON "enquiries"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "enquiries_organizationId_channel_idx" ON "enquiries"("organizationId", "channel");

-- CreateIndex
CREATE INDEX "enquiries_linkedLeadId_idx" ON "enquiries"("linkedLeadId");

-- CreateIndex
CREATE INDEX "enquiries_contactId_idx" ON "enquiries"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_originEnquiryId_key" ON "leads"("originEnquiryId");

-- CreateIndex
CREATE INDEX "leads_organizationId_idx" ON "leads"("organizationId");

-- CreateIndex
CREATE INDEX "leads_organizationId_status_idx" ON "leads"("organizationId", "status");

-- CreateIndex
CREATE INDEX "leads_organizationId_contactId_idx" ON "leads"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "leads_organizationId_projectId_idx" ON "leads"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "leads_organizationId_assignedAgentId_idx" ON "leads"("organizationId", "assignedAgentId");

-- CreateIndex
CREATE INDEX "leads_contactId_idx" ON "leads"("contactId");

-- CreateIndex
CREATE INDEX "leads_deletedAt_idx" ON "leads"("deletedAt");

-- CreateIndex
CREATE INDEX "assignment_rules_organizationId_idx" ON "assignment_rules"("organizationId");

-- CreateIndex
CREATE INDEX "assignment_rules_organizationId_active_idx" ON "assignment_rules"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "round_robin_states_teamId_key" ON "round_robin_states"("teamId");

-- CreateIndex
CREATE INDEX "round_robin_states_organizationId_idx" ON "round_robin_states"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "round_robin_states_organizationId_teamId_key" ON "round_robin_states"("organizationId", "teamId");

-- CreateIndex
CREATE INDEX "idempotency_keys_organizationId_idx" ON "idempotency_keys"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_organizationId_key_operationType_key" ON "idempotency_keys"("organizationId", "key", "operationType");

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_linkedLeadId_fkey" FOREIGN KEY ("linkedLeadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_originEnquiryId_fkey" FOREIGN KEY ("originEnquiryId") REFERENCES "enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_robin_states" ADD CONSTRAINT "round_robin_states_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_robin_states" ADD CONSTRAINT "round_robin_states_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
