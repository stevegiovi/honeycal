-- ============================================================================
-- HoneyCal: Row-Level Security Policies
-- ============================================================================
-- Principle: RLS enabled on every table, deny by default.
-- Client gets SELECT on own/partnership data.
-- All writes go through security definer RPCs or service_role Edge Functions.
-- ============================================================================

-- -------------------------------------------------------
-- Helper: check partnership membership
-- -------------------------------------------------------

create or replace function public.is_partnership_member(p_partnership_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.partnerships
    where id = p_partnership_id
      and status = 'active'
      and (partner_a_id = auth.uid() or partner_b_id = auth.uid())
  );
$$;

-- -------------------------------------------------------
-- profiles
-- -------------------------------------------------------

-- Read own profile
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- Read partner's profile
create policy "profiles_select_partner"
  on public.profiles for select
  using (
    exists (
      select 1 from public.partnerships p
      where p.status = 'active'
        and (
          (p.partner_a_id = auth.uid() and p.partner_b_id = id)
          or (p.partner_b_id = auth.uid() and p.partner_a_id = id)
        )
    )
  );

-- Update own profile (display_name, avatar_url only)
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No client insert (auto-created by trigger).
-- No client delete.

-- -------------------------------------------------------
-- partnerships
-- -------------------------------------------------------

-- Read own partnerships
create policy "partnerships_select_own"
  on public.partnerships for select
  using (partner_a_id = auth.uid() or partner_b_id = auth.uid());

-- Read pending partnerships (for invite code lookup during join)
create policy "partnerships_select_pending"
  on public.partnerships for select
  using (status = 'pending');

-- Create partnership (as partner_a)
create policy "partnerships_insert"
  on public.partnerships for insert
  with check (partner_a_id = auth.uid() and partner_b_id is null);

-- No client update (join is via join_partnership RPC).
-- No client delete.

-- -------------------------------------------------------
-- google_calendar_connections
-- -------------------------------------------------------

-- Read own connection (to show status in UI)
create policy "gcal_select_own"
  on public.google_calendar_connections for select
  using (profile_id = auth.uid());

-- Delete own connection (disconnect calendar)
create policy "gcal_delete_own"
  on public.google_calendar_connections for delete
  using (profile_id = auth.uid());

-- No client insert (via google-auth-callback Edge Function).
-- No client update (via Edge Functions).

-- -------------------------------------------------------
-- proposals
-- -------------------------------------------------------

-- Read proposals in own partnership
create policy "proposals_select"
  on public.proposals for select
  using (public.is_partnership_member(partnership_id));

-- No client insert (via create_proposal RPC).
-- No client update (via proposal-action Edge Function).
-- No client delete.

-- -------------------------------------------------------
-- proposal_versions
-- -------------------------------------------------------

-- Read versions for proposals in own partnership
create policy "proposal_versions_select"
  on public.proposal_versions for select
  using (
    exists (
      select 1 from public.proposals p
      where p.id = proposal_id
        and public.is_partnership_member(p.partnership_id)
    )
  );

-- No client insert (via create_proposal RPC or proposal-action Edge Function).
-- Immutable: no update or delete.

-- -------------------------------------------------------
-- proposal_actions
-- -------------------------------------------------------

-- Read actions for proposals in own partnership
create policy "proposal_actions_select"
  on public.proposal_actions for select
  using (
    exists (
      select 1 from public.proposals p
      where p.id = proposal_id
        and public.is_partnership_member(p.partnership_id)
    )
  );

-- No client insert (via create_proposal RPC or proposal-action Edge Function).
-- Immutable: no update or delete.

-- -------------------------------------------------------
-- calendar_events
-- -------------------------------------------------------

-- Read calendar events for proposals in own partnership
create policy "calendar_events_select"
  on public.calendar_events for select
  using (
    exists (
      select 1 from public.proposals p
      where p.id = proposal_id
        and public.is_partnership_member(p.partnership_id)
    )
  );

-- No client insert, update, or delete (all via Edge Functions).
