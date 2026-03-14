-- ============================================================================
-- HoneyCal: Tighten RLS
-- ============================================================================
-- Removes the broad "partnerships_select_pending" policy, which previously
-- allowed any authenticated user to SELECT all pending partnership rows,
-- exposing invite_code values to the entire user base.
--
-- The join flow now relies entirely on the join_partnership SECURITY DEFINER
-- RPC (004_backend_rpcs.sql), which validates the invite code inside the
-- database without requiring client-side SELECT access to pending rows.
--
-- The "partnerships_select_own" policy is preserved: creators can still read
-- their own pending partnership (partner_a_id = auth.uid()) to display the
-- invite code to the user who generated it.
-- ============================================================================

-- Drop the policy that exposes all pending partnerships (and their invite codes)
-- to every authenticated client.
drop policy if exists "partnerships_select_pending" on public.partnerships;

-- Tighten is_partnership_member: already checks status = 'active', no change needed.
-- All downstream RLS policies that use is_partnership_member() are unaffected.
