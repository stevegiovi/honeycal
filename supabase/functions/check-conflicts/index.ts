import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { getPartnershipForUser } from "../_shared/partnership.ts";
import { getValidToken, queryFreeBusy } from "../_shared/google-calendar.ts";
import { errorResponse, jsonResponse } from "../_shared/errors.ts";
import type { CheckConflictsRequest } from "../_shared/types.ts";

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
  let body: CheckConflictsRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (!body.proposed_start || !body.proposed_end) {
    return errorResponse(400, "proposed_start and proposed_end are required");
  }

  const start = new Date(body.proposed_start);
  const end = new Date(body.proposed_end);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return errorResponse(400, "Invalid datetime format");
  }
  if (end <= start) {
    return errorResponse(400, "proposed_end must be after proposed_start");
  }

  // 3. Load partnership
  const adminClient = createAdminClient();
  const roles = await getPartnershipForUser(adminClient, userId);
  if (!roles) {
    return errorResponse(403, "Not in an active partnership");
  }

  // 4. Get tokens
  const tokenMe = await getValidToken(adminClient, roles.meId);
  const tokenPartner = await getValidToken(adminClient, roles.partnerId);

  if (!tokenMe || !tokenPartner) {
    return errorResponse(
      424,
      "One or both partners have not connected Google Calendar",
      {
        me_connected: !!tokenMe,
        partner_connected: !!tokenPartner,
      },
    );
  }

  // 5. Query freebusy
  const timeMin = start.toISOString();
  const timeMax = end.toISOString();

  let busyMe, busyPartner;
  try {
    [busyMe, busyPartner] = await Promise.all([
      queryFreeBusy(tokenMe.accessToken, tokenMe.calendarId, timeMin, timeMax),
      queryFreeBusy(
        tokenPartner.accessToken,
        tokenPartner.calendarId,
        timeMin,
        timeMax,
      ),
    ]);
  } catch (err) {
    return errorResponse(
      424,
      "Failed to query Google Calendar",
      (err as Error).message,
    );
  }

  return jsonResponse({
    me: {
      has_conflict: busyMe.length > 0,
      busy_times: busyMe,
    },
    partner: {
      has_conflict: busyPartner.length > 0,
      busy_times: busyPartner,
    },
  });
});
