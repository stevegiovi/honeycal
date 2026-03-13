import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { getPartnershipForUser } from "../_shared/partnership.ts";
import {
  getValidToken,
  deleteCalendarEvent,
} from "../_shared/google-calendar.ts";
import { errorResponse, jsonResponse } from "../_shared/errors.ts";
import type { Proposal, CalendarEvent, CancelEventRequest } from "../_shared/types.ts";

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
  let body: CancelEventRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (!body.proposal_id) {
    return errorResponse(400, "proposal_id is required");
  }

  const adminClient = createAdminClient();
  const isRetry = body.retry === true;

  // 3. Load proposal
  const { data: proposal, error: pErr } = await adminClient
    .from("proposals")
    .select("*")
    .eq("id", body.proposal_id)
    .single();

  if (pErr || !proposal) {
    return errorResponse(404, "Proposal not found");
  }

  const p = proposal as Proposal;

  if (p.status !== "finalized") {
    return errorResponse(400, `Cannot cancel from status '${p.status}'`);
  }

  // 4. Verify partnership membership
  const roles = await getPartnershipForUser(
    adminClient,
    userId,
    p.partnership_id,
  );
  if (!roles) {
    return errorResponse(403, "Not a member of this partnership");
  }

  // 5. Load calendar_events
  const { data: calEvent, error: calErr } = await adminClient
    .from("calendar_events")
    .select("*")
    .eq("proposal_id", body.proposal_id)
    .single();

  if (calErr || !calEvent) {
    return errorResponse(500, "Calendar event record not found");
  }

  const ce = calEvent as CalendarEvent;

  // 6. Determine which events to delete
  const tokenA = await getValidToken(adminClient, roles.meId);
  const tokenB = await getValidToken(adminClient, roles.partnerId);

  let deleteASuccess = !ce.gcal_event_id_a; // Already null = already done
  let deleteBSuccess = !ce.gcal_event_id_b;
  let deleteAError: string | null = null;
  let deleteBError: string | null = null;

  // If retry, only attempt the ones that still have event IDs
  // If not retry, attempt all that have event IDs

  // Delete from calendar A
  if (ce.gcal_event_id_a && tokenA) {
    try {
      await deleteCalendarEvent(
        tokenA.accessToken,
        tokenA.calendarId,
        ce.gcal_event_id_a,
      );
      deleteASuccess = true;
    } catch (err) {
      deleteAError = (err as Error).message;
    }
  } else if (ce.gcal_event_id_a && !tokenA) {
    deleteAError = "Calendar connection unavailable";
  }

  // Delete from calendar B (always attempt, even if A failed)
  if (ce.gcal_event_id_b && tokenB) {
    try {
      await deleteCalendarEvent(
        tokenB.accessToken,
        tokenB.calendarId,
        ce.gcal_event_id_b,
      );
      deleteBSuccess = true;
    } catch (err) {
      deleteBError = (err as Error).message;
    }
  } else if (ce.gcal_event_id_b && !tokenB) {
    deleteBError = "Calendar connection unavailable";
  }

  // 7. Determine outcome
  const atLeastOneDeleted = deleteASuccess || deleteBSuccess;
  const bothDeleted = deleteASuccess && deleteBSuccess;

  if (!atLeastOneDeleted) {
    // Both failed → status stays finalized
    return errorResponse(
      424,
      "Both calendar deletions failed. Event remains finalized.",
      { error_a: deleteAError, error_b: deleteBError },
    );
  }

  // At least one succeeded → commit to cancellation
  const newSyncStatus = bothDeleted ? "synced" : "partial_failure";
  const syncError = deleteAError ?? deleteBError ?? null;

  // Update calendar_events
  await adminClient
    .from("calendar_events")
    .update({
      gcal_event_id_a: deleteASuccess ? null : ce.gcal_event_id_a,
      gcal_event_id_b: deleteBSuccess ? null : ce.gcal_event_id_b,
      sync_status: newSyncStatus,
      last_sync_error: syncError,
      synced_at: new Date().toISOString(),
    })
    .eq("proposal_id", body.proposal_id);

  // Update proposal status
  await adminClient
    .from("proposals")
    .update({ status: "cancelled", pending_actor_id: null })
    .eq("id", body.proposal_id);

  // Record action
  await adminClient.from("proposal_actions").insert({
    proposal_id: body.proposal_id,
    actor_id: userId,
    action: "cancelled",
    version_number: null,
    metadata: !bothDeleted
      ? { partial_failure: true, error: syncError }
      : null,
  });

  // Load updated records for response
  const { data: updatedProposal } = await adminClient
    .from("proposals")
    .select("*")
    .eq("id", body.proposal_id)
    .single();

  const { data: updatedCalEvent } = await adminClient
    .from("calendar_events")
    .select("*")
    .eq("proposal_id", body.proposal_id)
    .single();

  const { data: actionRecord } = await adminClient
    .from("proposal_actions")
    .select("*")
    .eq("proposal_id", body.proposal_id)
    .eq("action", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return jsonResponse({
    proposal: updatedProposal,
    action: actionRecord,
    calendar_event: updatedCalEvent,
  });
});
