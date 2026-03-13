import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { encrypt } from "../_shared/crypto.ts";
import { errorResponse, jsonResponse } from "../_shared/errors.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned",
];

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
  let body: { code: string; redirect_uri: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (!body.code || !body.redirect_uri) {
    return errorResponse(400, "code and redirect_uri are required");
  }

  // 3. Exchange auth code for tokens
  const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: body.code,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      redirect_uri: body.redirect_uri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    const errBody = await tokenResp.text();
    return errorResponse(400, "Failed to exchange authorization code", errBody);
  }

  const tokenData = await tokenResp.json();
  const { access_token, refresh_token, expires_in, scope } = tokenData;

  if (!access_token || !refresh_token) {
    return errorResponse(
      400,
      "Google did not return required tokens. Ensure access_type=offline and prompt=consent.",
    );
  }

  // 4. Verify scopes
  const grantedScopes = (scope as string).split(" ");
  const missingScopes = REQUIRED_SCOPES.filter(
    (s) => !grantedScopes.includes(s),
  );

  if (missingScopes.length > 0) {
    return errorResponse(
      403,
      `Insufficient Google Calendar permissions. Missing: ${missingScopes.join(", ")}`,
    );
  }

  // 5. Encrypt tokens
  const encryptedAccess = await encrypt(access_token);
  const encryptedRefresh = await encrypt(refresh_token);
  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

  // 6. Upsert into google_calendar_connections
  const adminClient = createAdminClient();

  const { error: upsertError } = await adminClient
    .from("google_calendar_connections")
    .upsert(
      {
        profile_id: userId,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        token_expires_at: expiresAt,
        calendar_id: "primary",
        scopes: grantedScopes,
      },
      { onConflict: "profile_id" },
    );

  if (upsertError) {
    return errorResponse(500, "Failed to save calendar connection", upsertError.message);
  }

  return jsonResponse({
    success: true,
    calendar_id: "primary",
    scopes: grantedScopes,
  });
});
