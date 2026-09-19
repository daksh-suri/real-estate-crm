-- One active OPEN Lead per Organization + Contact + Project.
-- Closed (CONVERTED/DISQUALIFIED) and soft-deleted rows are excluded so a new
-- Lead can open after the previous one closes. Project-less Leads
-- (projectId IS NULL) intentionally allow multiples per Contact, so NULL
-- project rows are excluded (NULLs would never conflict in a unique index
-- anyway; the predicate documents the intent).
CREATE UNIQUE INDEX "leads_open_contact_project_key" ON "leads"("organizationId", "contactId", "projectId") WHERE "status" = 'OPEN' AND "deletedAt" IS NULL AND "projectId" IS NOT NULL;
