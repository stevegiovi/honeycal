import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encrypt, decrypt } from "./crypto.ts";
import type { GoogleCalendarConnection, TimeSlot } from "./types.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function getGoogleClientId(): string {
  return Deno.env.get("GOOGLE_CLIENT_ID")!;
}

function getGoogleClientSecret(): string {
  return Deno.env.get("GOOGLE_CLIENT_SECRET")!;
}

// -------------------------------------------------------
// Token management
// -------------------------------------------------------

export interface DecryptedConnection {
  profileId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  calendarId: string;
}

export async function loadConnection(
  adminClient: SupabaseClient,
  profileId: string,
): Promise<DecryptedConnection | null> {
  const { data, error } = await adminClient
    .from("google_calendar_connections")
    .select("*")
    .eq("profile_id", profileId)
    .single();

  if (error || !data) return null;

  const conn = data as GoogleCalendarConnection;
  return {
    profileId: conn.profile_id,
    accessToken: await decrypt(conn.access_token),
    refreshToken: await decrypt(conn.refresh_token),
    tokenExpiresAt: new Date(conn.token_expires_at),
    calendarId: conn.calendar_id,
  };
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Token refresh failed: ${resp.status} ${body}`);
  }

  return resp.json();
}

async function updateStoredToken(
  adminClient: SupabaseClient,
  profileId: string,
  accessToken: string,
  expiresAt: Date,
): Promise<void> {
  await adminClient
    .from("google_calendar_connections")
    .update({
      access_token: await encrypt(accessToken),
      token_expires_at: expiresAt.toISOString(),
    })
    .eq("profile_id", profileId);
}

/**
 * Get a valid access token for a profile, refreshing if expired.
 */
export async function getValidToken(
  adminClient: SupabaseClient,
  profileId: string,
): Promise<{ accessToken: string; calendarId: string } | null> {
  const conn = await loadConnection(adminClient, profileId);
  if (!conn) return null;

  // Refresh if token expires within 60 seconds
  const now = new Date();
  const buffer = 60_000;
  if (conn.tokenExpiresAt.getTime() - now.getTime() < buffer) {
    try {
      const refreshed = await refreshAccessToken(conn.refreshToken);
      const newExpiry = new Date(
        now.getTime() + refreshed.expires_in * 1000,
      );
      await updateStoredToken(
        adminClient,
        profileId,
        refreshed.access_token,
        newExpiry,
      );
      return { accessToken: refreshed.access_token, calendarId: conn.calendarId };
    } catch {
      return null;
    }
  }

  return { accessToken: conn.accessToken, calendarId: conn.calendarId };
}

// -------------------------------------------------------
// FreeBusy API
// -------------------------------------------------------

export interface BusyPeriod {
  start: string;
  end: string;
}

export async function queryFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<BusyPeriod[]> {
  const resp = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`FreeBusy query failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  const calendars = data.calendars ?? {};
  const calData = calendars[calendarId] ?? {};
  return (calData.busy ?? []) as BusyPeriod[];
}

// -------------------------------------------------------
// Event creation / deletion
// -------------------------------------------------------

export interface CreateEventParams {
  accessToken: string;
  calendarId: string;
  summary: string;
  location?: string;
  start: string;
  end: string;
  description?: string;
}

export interface CreatedEvent {
  id: string;
  htmlLink: string;
}

export async function createCalendarEvent(
  params: CreateEventParams,
): Promise<CreatedEvent> {
  const resp = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(params.calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: params.summary,
        location: params.location ?? undefined,
        description: params.description ?? undefined,
        start: { dateTime: params.start },
        end: { dateTime: params.end },
      }),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Create event failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  return { id: data.id, htmlLink: data.htmlLink };
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<{ success: boolean; notFound: boolean }> {
  const resp = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  // 204 = deleted, 404/410 = already gone (treat as success)
  if (resp.status === 204 || resp.status === 200) {
    return { success: true, notFound: false };
  }
  if (resp.status === 404 || resp.status === 410) {
    return { success: true, notFound: true };
  }

  const body = await resp.text();
  throw new Error(`Delete event failed: ${resp.status} ${body}`);
}

// -------------------------------------------------------
// Slot generation
// -------------------------------------------------------

/**
 * Given busy periods for both partners, find conflict-free slots
 * of the requested duration within the given time window.
 */
export function computeAvailableSlots(
  busyA: BusyPeriod[],
  busyB: BusyPeriod[],
  rangeStart: Date,
  rangeEnd: Date,
  durationMs: number,
  dayStartHour?: number,
  dayEndHour?: number,
): TimeSlot[] {
  // Merge and sort all busy periods
  const allBusy = [...busyA, ...busyB]
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .sort((a, b) => a.start - b.start);

  // Merge overlapping busy periods
  const merged: { start: number; end: number }[] = [];
  for (const period of allBusy) {
    if (merged.length > 0 && period.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(
        merged[merged.length - 1].end,
        period.end,
      );
    } else {
      merged.push({ ...period });
    }
  }

  // Walk day by day through the range
  const slots: TimeSlot[] = [];
  const current = new Date(rangeStart);

  while (current < rangeEnd && slots.length < 20) {
    // Determine window for this day
    const dayStart = new Date(current);
    if (dayStartHour !== undefined) {
      dayStart.setUTCHours(dayStartHour, 0, 0, 0);
    }
    const dayEnd = new Date(current);
    if (dayEndHour !== undefined) {
      dayEnd.setUTCHours(dayEndHour, 0, 0, 0);
    } else {
      dayEnd.setUTCHours(23, 59, 59, 999);
    }

    // Clamp to overall range
    const windowStart = Math.max(dayStart.getTime(), rangeStart.getTime());
    const windowEnd = Math.min(dayEnd.getTime(), rangeEnd.getTime());

    if (windowEnd - windowStart >= durationMs) {
      // Find free periods within this window
      let cursor = windowStart;
      for (const busy of merged) {
        if (busy.start >= windowEnd) break;
        if (busy.end <= cursor) continue;

        // Gap before this busy period
        if (busy.start > cursor && busy.start - cursor >= durationMs) {
          // Emit slot(s) in this gap
          let slotStart = cursor;
          while (
            slotStart + durationMs <= busy.start &&
            slots.length < 20
          ) {
            slots.push({
              start: new Date(slotStart).toISOString(),
              end: new Date(slotStart + durationMs).toISOString(),
            });
            slotStart += durationMs; // Non-overlapping slots
          }
        }
        cursor = Math.max(cursor, busy.end);
      }

      // Gap after last busy period
      if (cursor + durationMs <= windowEnd) {
        let slotStart = cursor;
        while (
          slotStart + durationMs <= windowEnd &&
          slots.length < 20
        ) {
          slots.push({
            start: new Date(slotStart).toISOString(),
            end: new Date(slotStart + durationMs).toISOString(),
          });
          slotStart += durationMs;
        }
      }
    }

    // Next day
    current.setUTCDate(current.getUTCDate() + 1);
    current.setUTCHours(0, 0, 0, 0);
  }

  return slots;
}
