import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { getPartnershipForUser } from "../_shared/partnership.ts";
import {
  getValidToken,
  createCalendarEvent,
} from "../_shared/google-calendar.ts";
import { errorResponse, jsonResponse } from "../_shared/errors.ts";
import type {
  Proposal,
  ProposalVersion,
  ProposalActionRequest,
  ProposalStatus,
} from "../_shared/types.ts";

// -------------------------------------------------------
// Transition matrix: [currentStatus][action] → nextStatus
// -------------------------------------------------------

type UserAction = "accept" | "counter" | "decline" | "withdraw";

const TRANSITIONS: Record<string, Record<UserAction, ProposalStatus | null>> = {
  proposed: {
    accept: "accepted",
    counter: "counter_proposed",
    decline: "declined",
    withdraw: "withdrawn",
  },
  counter_proposed: {
    accept: "accepted",
    counter: "counter_proposed",
    decline: "declined",
    withdraw: "withdrawn",
  },
};

// Actions that require the caller to be the pending_actor
const PENDING_ACTOR_ONLY: Set<string> = new Set([
  "accept",
  "counter",
  "decline",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  // 1. Authenticate
  const authResult = await getAuthenticatedUser(
    req.headers.get("Authorization"),
  );
  if ("error" in authResult) {
    return errorResponse(401, authResult.error);
  }
  const { userId } = authResult;

  // 2. Parse request
  let body: ProposalActionRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (!body.proposal_id || !body.action) {
    return errorResponse(400, "proposal_id and action are required");
  }

  const adminClient = createAdminClient();

  // Handle retry_finalize separately
  if (body.action === "retry_finalize") {
    return handleRetryFinalize(adminClient, userId, body.proposal_id);
  }

  const action = body.action as UserAction;

  // 3. Load proposal with row lock (prevents concurrent accept/counter races)
  const { data: proposal, error: loadErr } = await adminClient
    .rpc("load_proposal_for_update", { p_proposal_id: body.proposal_id });

  if (loadErr || !proposal) {
    return errorResponse(404, "Proposal not found");
  }
  const lockedProposal = proposal as Proposal;

  // 4. Verify partnership membership
  const roles = await getPartnershipForUser(
    adminClient,
    userId,
    lockedProposal.partnership_id,
  );
  if (!roles) {
    return errorResponse(403, "Not a member of this partnership");
  }

  // 5. Validate transition
  const allowedTransitions = TRANSITIONS[lockedProposal.status];
  if (!allowedTransitions) {
    return errorResponse(
      400,
      `No actions allowed from status '${lockedProposal.status}'`,
    );
  }

  const nextStatus = allowedTransitions[action];
  if (nextStatus === undefined || nextStatus === null) {
    return errorResponse(
      400,
      `Action '${action}' is not valid from status '${lockedProposal.status}'`,
    );
  }

  // 6. Verify actor constraint
  if (PENDING_ACTOR_ONLY.has(action)) {
    if (lockedProposal.pending_actor_id !== userId) {
      return errorResponse(
        403,
        "Only the pending actor can perform this action",
      );
    }
  }

  // 7. Compute new pending_actor_id
  let newPendingActorId: string | null = null;
  if (action === "counter") {
    // Flip to the other partner
    newPendingActorId =
      userId === roles.meId ? roles.partnerId : roles.meId;
  }
  // accept, decline, withdraw → null

  // 8. Handle counter: validate and create new version
  let newVersionNumber: number | null = null;
  if (action === "counter") {
    if (!body.version) {
      return errorResponse(
        400,
        "version payload is required for counter action",
      );
    }
    const v = body.version;
    if (!v.title || !v.proposed_start || !v.proposed_end) {
      return errorResponse(
        400,
        "version.title, version.proposed_start, and version.proposed_end are required",
      );
    }
    if (new Date(v.proposed_end) <= new Date(v.proposed_start)) {
      return errorResponse(
        400,
        "version.proposed_end must be after version.proposed_start",
      );
    }

    newVersionNumber = lockedProposal.current_version + 1;

    const { error: versionErr } = await adminClient
      .from("proposal_versions")
      .insert({
        proposal_id: lockedProposal.id,
        version_number: newVersionNumber,
        created_by: userId,
        title: v.title,
        location: v.location ?? null,
        proposed_start: v.proposed_start,
        proposed_end: v.proposed_end,
        notes: v.notes ?? null,
      });

    if (versionErr) {
      return errorResponse(500, "Failed to create proposal version", versionErr.message);
    }
  }

  // 9. Update proposal
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    pending_actor_id: newPendingActorId,
  };
  if (newVersionNumber !== null) {
    updatePayload.current_version = newVersionNumber;
  }

  const { error: updateErr } = await adminClient
    .from("proposals")
    .update(updatePayload)
    .eq("id", lockedProposal.id);

  if (updateErr) {
    return errorResponse(500, "Failed to update proposal", updateErr.message);
  }

  // 10. Record action
  const actionType =
    action === "accept"
      ? "accepted"
      : action === "counter"
        ? "countered"
        : action === "decline"
          ? "declined"
          : "withdrawn";

  const { data: actionRow, error: actionErr } = await adminClient
    .from("proposal_actions")
    .insert({
      proposal_id: lockedProposal.id,
      actor_id: userId,
      action: actionType,
      version_number: newVersionNumber,
      note: body.note ?? null,
    })
    .select()
    .single();

  if (actionErr) {
    return errorResponse(500, "Failed to record action", actionErr.message);
  }

  // 11. If accepted → attempt server-owned finalization
  let calendarEvent = null;
  let finalStatus: ProposalStatus = nextStatus;

  if (nextStatus === "accepted") {
    const finResult = await attemptFinalization(
      adminClient,
      lockedProposal.id,
      roles.meId,
      roles.partnerId,
    );
    if (finResult.finalized) {
      finalStatus = "finalized";
    }
    calendarEvent = finResult.calendarEvent;
  }

  // 12. Load current version for response
  const { data: currentVersion } = await adminClient
    .from("proposal_versions")
    .select("*")
    .eq("proposal_id", lockedProposal.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  // 13. Load updated proposal for response
  const { data: updatedProposal } = await adminClient
    .from("proposals")
    .select("*")
    .eq("id", lockedProposal.id)
    .single();

  return jsonResponse({
    proposal: updatedProposal,
    version: currentVersion,
    action: actionRow,
    calendar_event: calendarEvent,
  });
});

// -------------------------------------------------------
// Server-owned finalization
// -------------------------------------------------------

interface FinalizationResult {
  finalized: boolean;
  calendarEvent: Record<string, unknown> | null;
}

async function attemptFinalization(
  adminClient: ReturnType<typeof createAdminClient>,
  proposalId: string,
  meId: string,
  partnerId: string,
): Promise<FinalizationResult> {
  // Load the current version
  const { data: version, error: vErr } = await adminClient
    .from("proposal_versions")
    .select("*")
    .eq("proposal_id", proposalId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (vErr || !version) {
    return { finalized: false, calendarEvent: null };
  }

  const v = version as ProposalVersion;

  // Get both tokens
  const tokenA = await getValidToken(adminClient, meId);
  const tokenB = await getValidToken(adminClient, partnerId);

  if (!tokenA || !tokenB) {
    // Cannot finalize without both calendars — stay accepted
    return { finalized: false, calendarEvent: null };
  }

  const eventDescription = `HoneyCal event${v.notes ? `: ${v.notes}` : ""}`;

  // Attempt to write to first partner's calendar
  let eventIdA: string | null = null;
  let eventIdB: string | null = null;
  let writeAError: string | null = null;
  let writeBError: string | null = null;

  try {
    const resultA = await createCalendarEvent({
      accessToken: tokenA.accessToken,
      calendarId: tokenA.calendarId,
      summary: v.title,
      location: v.location ?? undefined,
      start: v.proposed_start,
      end: v.proposed_end,
      description: eventDescription,
    });
    eventIdA = resultA.id;
  } catch (err) {
    writeAError = (err as Error).message;
  }

  // Always attempt second write regardless of first result
  try {
    const resultB = await createCalendarEvent({
      accessToken: tokenB.accessToken,
      calendarId: tokenB.calendarId,
      summary: v.title,
      location: v.location ?? undefined,
      start: v.proposed_start,
      end: v.proposed_end,
      description: eventDescription,
    });
    eventIdB = resultB.id;
  } catch (err) {
    writeBError = (err as Error).message;
  }

  // Both failed → stay accepted, no calendar_events row
  if (!eventIdA && !eventIdB) {
    return { finalized: false, calendarEvent: null };
  }

  // At least one succeeded → finalize
  const syncStatus =
    eventIdA && eventIdB ? "synced" : "partial_failure";
  const syncError =
    writeAError ?? writeBError ?? null;

  // Insert calendar_events
  const { data: calEvent, error: calErr } = await adminClient
    .from("calendar_events")
    .insert({
      proposal_id: proposalId,
      gcal_event_id_a: eventIdA,
      gcal_event_id_b: eventIdB,
      sync_status: syncStatus,
      last_sync_error: syncError,
    })
    .select()
    .single();

  if (calErr) {
    return { finalized: false, calendarEvent: null };
  }

  // Update proposal to finalized
  await adminClient
    .from("proposals")
    .update({ status: "finalized", pending_actor_id: null })
    .eq("id", proposalId);

  // Record finalized action
  await adminClient.from("proposal_actions").insert({
    proposal_id: proposalId,
    actor_id: null,
    action: "finalized",
    version_number: null,
    metadata: syncStatus === "partial_failure"
      ? { partial_failure: true, error: syncError }
      : null,
  });

  return { finalized: true, calendarEvent: calEvent };
}

// -------------------------------------------------------
// Retry finalize
// -------------------------------------------------------

async function handleRetryFinalize(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  proposalId: string,
): Promise<Response> {
  // Load proposal
  const { data: proposal, error } = await adminClient
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (error || !proposal) {
    return errorResponse(404, "Proposal not found");
  }

  const p = proposal as Proposal;

  // Verify partnership membership
  const roles = await getPartnershipForUser(
    adminClient,
    userId,
    p.partnership_id,
  );
  if (!roles) {
    return errorResponse(403, "Not a member of this partnership");
  }

  // Can retry if accepted (both writes failed) or finalized with partial_failure
  if (p.status === "accepted") {
    const result = await attemptFinalization(
      adminClient,
      proposalId,
      roles.meId,
      roles.partnerId,
    );

    const { data: updatedProposal } = await adminClient
      .from("proposals")
      .select("*")
      .eq("id", proposalId)
      .single();

    return jsonResponse({
      proposal: updatedProposal,
      calendar_event: result.calendarEvent,
      retried: true,
      finalized: result.finalized,
    });
  }

  if (p.status === "finalized") {
    // Check for partial_failure
    const { data: calEvent } = await adminClient
      .from("calendar_events")
      .select("*")
      .eq("proposal_id", proposalId)
      .single();

    if (!calEvent || calEvent.sync_status !== "partial_failure") {
      return errorResponse(400, "Nothing to retry — event is fully synced");
    }

    // Retry the missing write
    const version = await adminClient
      .from("proposal_versions")
      .select("*")
      .eq("proposal_id", proposalId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    if (!version.data) {
      return errorResponse(500, "Could not load proposal version");
    }

    const v = version.data as ProposalVersion;
    const eventDescription = `HoneyCal event${v.notes ? `: ${v.notes}` : ""}`;

    // Determine which write failed
    const missingA = !calEvent.gcal_event_id_a;
    const missingB = !calEvent.gcal_event_id_b;
    const targetId = missingA ? roles.meId : roles.partnerId;
    const token = await getValidToken(adminClient, targetId);

    if (!token) {
      return errorResponse(424, "Calendar connection unavailable for retry");
    }

    try {
      const result = await createCalendarEvent({
        accessToken: token.accessToken,
        calendarId: token.calendarId,
        summary: v.title,
        location: v.location ?? undefined,
        start: v.proposed_start,
        end: v.proposed_end,
        description: eventDescription,
      });

      // Update calendar_events
      const updatePayload: Record<string, unknown> = {
        sync_status: "synced",
        last_sync_error: null,
        synced_at: new Date().toISOString(),
      };
      if (missingA) updatePayload.gcal_event_id_a = result.id;
      if (missingB) updatePayload.gcal_event_id_b = result.id;

      await adminClient
        .from("calendar_events")
        .update(updatePayload)
        .eq("proposal_id", proposalId);

      const { data: updatedCalEvent } = await adminClient
        .from("calendar_events")
        .select("*")
        .eq("proposal_id", proposalId)
        .single();

      return jsonResponse({
        proposal: p,
        calendar_event: updatedCalEvent,
        retried: true,
        finalized: true,
      });
    } catch (err) {
      return errorResponse(
        424,
        "Retry failed",
        (err as Error).message,
      );
    }
  }

  return errorResponse(
    400,
    `Cannot retry finalization from status '${p.status}'`,
  );
}
