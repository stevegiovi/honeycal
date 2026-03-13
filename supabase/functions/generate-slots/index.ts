import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { getPartnershipForUser } from "../_shared/partnership.ts";
import {
  getValidToken,
  queryFreeBusy,
  computeAvailableSlots,
} from "../_shared/google-calendar.ts";
import { errorResponse, jsonResponse } from "../_shared/errors.ts";
import type { GenerateSlotsRequest } from "../_shared/types.ts";

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
  let body: GenerateSlotsRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (
    !body.date_range_start ||
    !body.date_range_end ||
    !body.duration_minutes ||
    body.duration_minutes < 15
  ) {
    return errorResponse(
      400,
      "date_range_start, date_range_end, and duration_minutes (>= 15) are required",
    );
  }

  const rangeStart = new Date(body.date_range_start);
  const rangeEnd = new Date(body.date_range_end);
  if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
    return errorResponse(400, "Invalid date format");
  }
  if (rangeEnd <= rangeStart) {
    return errorResponse(400, "date_range_end must be after date_range_start");
  }

  // Cap range to 14 days
  const maxRange = 14 * 24 * 60 * 60 * 1000;
  if (rangeEnd.getTime() - rangeStart.getTime() > maxRange) {
    return errorResponse(400, "Date range must not exceed 14 days");
  }

  // 3. Load partnership
  const adminClient = createAdminClient();
  const roles = await getPartnershipForUser(adminClient, userId);
  if (!roles) {
    return errorResponse(403, "Not in an active partnership");
  }

  // 4. Get both partners' Google Calendar tokens
  const tokenA = await getValidToken(adminClient, roles.meId);
  const tokenB = await getValidToken(adminClient, roles.partnerId);

  if (!tokenA || !tokenB) {
    return errorResponse(
      424,
      "One or both partners have not connected Google Calendar",
      {
        me_connected: !!tokenA,
        partner_connected: !!tokenB,
      },
    );
  }

  // 5. Query freebusy for both
  const timeMin = rangeStart.toISOString();
  const timeMax = rangeEnd.toISOString();

  let busyA, busyB;
  try {
    [busyA, busyB] = await Promise.all([
      queryFreeBusy(tokenA.accessToken, tokenA.calendarId, timeMin, timeMax),
      queryFreeBusy(tokenB.accessToken, tokenB.calendarId, timeMin, timeMax),
    ]);
  } catch (err) {
    return errorResponse(
      424,
      "Failed to query Google Calendar",
      (err as Error).message,
    );
  }

  // 6. Compute available slots
  const durationMs = body.duration_minutes * 60 * 1000;
  const dayStartHour = body.time_window_start
    ? parseInt(body.time_window_start.split(":")[0], 10)
    : undefined;
  const dayEndHour = body.time_window_end
    ? parseInt(body.time_window_end.split(":")[0], 10)
    : undefined;

  const slots = computeAvailableSlots(
    busyA,
    busyB,
    rangeStart,
    rangeEnd,
    durationMs,
    dayStartHour,
    dayEndHour,
  );

  return jsonResponse({ slots });
});
