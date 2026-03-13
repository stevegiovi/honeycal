import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Partnership } from "./types.ts";

export interface PartnershipRoles {
  partnership: Partnership;
  meId: string;
  partnerId: string;
}

/**
 * Load an active partnership and resolve me/partner roles.
 * Uses admin client (service_role) since Edge Functions need cross-user access.
 */
export async function getPartnershipForUser(
  adminClient: SupabaseClient,
  userId: string,
  partnershipId?: string,
): Promise<PartnershipRoles | null> {
  let query = adminClient
    .from("partnerships")
    .select("*")
    .eq("status", "active");

  if (partnershipId) {
    query = query.eq("id", partnershipId);
  }

  // User could be partner_a or partner_b
  query = query.or(`partner_a_id.eq.${userId},partner_b_id.eq.${userId}`);

  const { data, error } = await query.limit(1).single();

  if (error || !data) {
    return null;
  }

  const partnership = data as Partnership;
  const meId =
    partnership.partner_a_id === userId
      ? partnership.partner_a_id
      : partnership.partner_b_id!;
  const partnerId =
    partnership.partner_a_id === userId
      ? partnership.partner_b_id!
      : partnership.partner_a_id;

  return { partnership, meId, partnerId };
}
