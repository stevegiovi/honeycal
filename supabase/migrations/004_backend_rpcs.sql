-- ============================================================================
-- HoneyCal: Backend RPCs & Security Tightening
-- ============================================================================
-- 1. create_proposal       – atomic proposal creation (security definer)
-- 2. join_partnership       – atomic partnership join  (security definer)
-- 3. load_proposal_for_update – SELECT … FOR UPDATE helper
-- 4. Tighten partnerships_select_pending RLS policy
-- ============================================================================

-- -------------------------------------------------------
-- 1. create_proposal
-- -------------------------------------------------------
-- Atomically inserts into proposals + proposal_versions + proposal_actions.
-- Validates: caller is a member of the active partnership.
-- Sets initial status='proposed', pending_actor_id=partner.
-- Security definer so it bypasses RLS and runs as DB owner.
-- -------------------------------------------------------

create or replace function public.create_proposal(
  p_partnership_id  uuid,
  p_title           text,
  p_location        text default null,
  p_proposed_start  timestamptz default null,
  p_proposed_end    timestamptz default null,
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id   uuid;
  v_partner_id  uuid;
  v_proposal_id uuid;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Validate required fields
  if p_title is null or p_title = '' then
    raise exception 'title is required';
  end if;
  if p_proposed_start is null then
    raise exception 'proposed_start is required';
  end if;
  if p_proposed_end is null then
    raise exception 'proposed_end is required';
  end if;
  if p_proposed_end <= p_proposed_start then
    raise exception 'proposed_end must be after proposed_start';
  end if;

  -- Validate partnership membership & resolve partner
  select partner_id into v_partner_id
  from public.get_partnership_roles(p_partnership_id, v_caller_id);

  if v_partner_id is null then
    raise exception 'Not a member of this active partnership';
  end if;

  -- Atomic: insert proposal
  insert into public.proposals (
    partnership_id,
    created_by,
    status,
    pending_actor_id,
    current_version
  ) values (
    p_partnership_id,
    v_caller_id,
    'proposed',
    v_partner_id,
    1
  )
  returning id into v_proposal_id;

  -- Atomic: insert first version
  insert into public.proposal_versions (
    proposal_id,
    version_number,
    created_by,
    title,
    location,
    proposed_start,
    proposed_end,
    notes
  ) values (
    v_proposal_id,
    1,
    v_caller_id,
    p_title,
    p_location,
    p_proposed_start,
    p_proposed_end,
    p_notes
  );

  -- Atomic: insert initial action
  insert into public.proposal_actions (
    proposal_id,
    actor_id,
    action,
    version_number
  ) values (
    v_proposal_id,
    v_caller_id,
    'proposed',
    1
  );

  return v_proposal_id;
end;
$$;

comment on function public.create_proposal is
  'Atomically creates a proposal with its first version and action record. Security definer.';

-- -------------------------------------------------------
-- 2. join_partnership
-- -------------------------------------------------------
-- Validates invite code, prevents self-join, prevents joining
-- if already in an active partnership, sets partner_b_id and
-- activates atomically. Uses FOR UPDATE to prevent races.
-- Security definer so the client doesn't need broad SELECT
-- on pending partnerships.
-- -------------------------------------------------------

create or replace function public.join_partnership(
  p_invite_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id      uuid;
  v_partnership_id  uuid;
  v_partner_a_id    uuid;
  v_existing_count  int;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_invite_code is null or p_invite_code = '' then
    raise exception 'invite_code is required';
  end if;

  -- Lock the target partnership row
  select id, partner_a_id
  into v_partnership_id, v_partner_a_id
  from public.partnerships
  where invite_code = p_invite_code
    and status = 'pending'
    and partner_b_id is null
  for update;

  if v_partnership_id is null then
    raise exception 'Invalid or expired invite code';
  end if;

  -- Prevent self-join
  if v_partner_a_id = v_caller_id then
    raise exception 'Cannot join your own partnership';
  end if;

  -- Prevent joining if already in an active (non-dissolved) partnership
  select count(*) into v_existing_count
  from public.partnerships
  where status != 'dissolved'
    and (partner_a_id = v_caller_id or partner_b_id = v_caller_id);

  if v_existing_count > 0 then
    raise exception 'Already in an active partnership';
  end if;

  -- Activate the partnership
  update public.partnerships
  set partner_b_id = v_caller_id,
      status = 'active'
  where id = v_partnership_id;

  return v_partnership_id;
end;
$$;

comment on function public.join_partnership is
  'Atomically joins a pending partnership via invite code. Validates no self-join and no existing partnership. Security definer.';

-- -------------------------------------------------------
-- 3. load_proposal_for_update
-- -------------------------------------------------------
-- Row-locking helper used by proposal-action Edge Function
-- to prevent concurrent accept/counter race conditions.
-- Returns the full proposal row with FOR UPDATE lock held
-- until the calling transaction commits.
-- -------------------------------------------------------

create or replace function public.load_proposal_for_update(
  p_proposal_id uuid
)
returns public.proposals
language sql
security definer
set search_path = ''
as $$
  select * from public.proposals
  where id = p_proposal_id
  for update;
$$;

comment on function public.load_proposal_for_update is
  'SELECT … FOR UPDATE on proposals. Used by proposal-action for concurrency control.';

-- -------------------------------------------------------
-- 4. Tighten partnerships_select_pending
-- -------------------------------------------------------
-- The original policy allowed ANY authenticated user to
-- read ALL pending partnerships (including invite codes).
-- Since join_partnership is now a security definer RPC that
-- looks up the partnership internally, clients no longer
-- need broad SELECT on pending partnerships.
--
-- Drop the overly permissive policy entirely.
-- -------------------------------------------------------

drop policy if exists "partnerships_select_pending" on public.partnerships;
