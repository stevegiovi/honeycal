import { createUserClient } from "./supabase-admin.ts";

export async function getAuthenticatedUser(
  authHeader: string | null,
): Promise<{ userId: string } | { error: string }> {
  if (!authHeader) {
    return { error: "Missing authorization header" };
  }

  const supabase = createUserClient(authHeader);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: "Invalid or expired token" };
  }

  return { userId: user.id };
}
