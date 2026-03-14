-- ============================================================================
-- HoneyCal: Tighten Partnership RLS
-- ============================================================================
-- Remove the partnerships_select_pending policy that let ANY authenticated
-- user read ALL pending partnerships (and their invite codes).
--
-- This is safe because:
--   • join_partnership() is security definer — it looks up the invite code
--     internally, bypassing RLS. The client never needs direct SELECT access
--     to pending partnerships it doesn't own.
--   • partnerships_select_own already lets partner_a see their own pending
--     partnership (to display the invite code they created).
-- ============================================================================

drop policy if exists "partnerships_select_pending" on public.partnerships;
