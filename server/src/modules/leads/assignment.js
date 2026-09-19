// Purpose-built Lead assignment (Phase 3 #10) — NOT a rules engine.
// Checkpoint 7 ships ROUND_ROBIN (+ manual reassignment) only. Each rule type
// is its own small function; config JSON carries parameters, never logic.
//
// MUST be called inside the Lead-creation transaction (tx): the round-robin
// counter row is SELECT ... FOR UPDATE locked so concurrent Lead creations
// serialize on "who is next" instead of double-assigning the same agent.

async function evaluateAssignment({ tx, organizationId, lead }) {
  void lead;
  const rules = await tx.assignmentRule.findMany({
    where: { active: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  for (const rule of rules) {
    if (rule.type === 'ROUND_ROBIN') {
      const teamId = rule.config && rule.config.teamId;
      if (!teamId) continue;
       
      const picked = await pickRoundRobin({ tx, organizationId, teamId });
      if (picked) return { assignedAgentId: picked, assignmentSource: 'AUTO', assignedAt: new Date() };
    }
  }
  return { assignedAgentId: null, assignmentSource: 'UNASSIGNED', assignedAt: null };
}

async function pickRoundRobin({ tx, organizationId, teamId }) {
  // Serialize concurrent Lead creations on the counter row. A missing row
  // means "never assigned for this team" — created below (P2002 on a lost
  // create-race propagates to the caller's retry; the transaction aborts
  // cleanly with no partial state).
  const locked = await tx._raw.$queryRaw`
    SELECT "id", "teamId", "organizationId", "lastIndex"
    FROM "round_robin_states"
    WHERE "teamId" = ${teamId}
    FOR UPDATE
  `;
  const state = locked && locked[0] ? locked[0] : null;
  if (state && state.organizationId !== organizationId) return null;

  // Eligible agents: team members whose user is ACTIVE and not soft-deleted.
  // Checked live (never cached) so deactivation takes effect immediately.
  // Deterministic id-sorted order so lastIndex is stable across evaluations.
  const memberships = await tx.teamMembership.findMany({ where: { teamId } });
  const userIds = [...new Set(memberships.map((m) => m.userId))].sort();
  const eligible = [];
  for (const userId of userIds) {
     
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (user && user.status === 'ACTIVE') eligible.push(user);
  }
  if (eligible.length === 0) return null;

  const lastIndex = state ? state.lastIndex : -1;
  const nextIndex = (lastIndex + 1) % eligible.length;
  const picked = eligible[nextIndex];

  if (state) {
    await tx.roundRobinState.update({
      where: { id: state.id },
      data: { lastAssignedUserId: picked.id, lastIndex: nextIndex },
    });
  } else {
    // Verify the team is visible in-tenant before creating counter state.
    // Invisible = missing, cross-tenant, or soft-deleted -> skip this rule.
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team) return null;
    await tx.roundRobinState.create({
      data: { teamId, lastAssignedUserId: picked.id, lastIndex: nextIndex },
    });
  }
  return picked.id;
}

module.exports = { evaluateAssignment, pickRoundRobin };
