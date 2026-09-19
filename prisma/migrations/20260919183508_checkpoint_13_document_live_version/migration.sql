-- At most one live version per document group and organization. Terminal
-- states (VERIFIED, REJECTED) and drafts (NOT_SUBMITTED) are excluded so a
-- resubmission can follow a rejection and a draft can be abandoned without
-- blocking the group. Concurrent resubmits serialize on the latest-row lock;
-- this index is the backstop that turns any residual race into a 409 instead
-- of a forked version history.
CREATE UNIQUE INDEX "documents_live_group_key" ON "documents"("organizationId", "groupId") WHERE "status" IN ('SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED');
