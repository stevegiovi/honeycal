-- ============================================================================
-- HoneyCal: Business-Logic RPCs
-- ============================================================================
-- Functions: create_proposal, join_partnership, load_proposal_for_update
-- All security definer with search_path locked down.
-- ============================================================================

-- -------------------------------------------------------
-- 1. create_proposal
-- -------------------------------------------------------
-- Atomic insert: proposals + proposal_versions + proposal_actions.
-- Validates partnership membership via get_partnership_roles().
-- Sets pending_actor to the OTHER partner.
-- -------------------------------------------------------

create or replace function public.create_proposal(
  p_partnership_id  uuid,
  p_title           text,
  p_proposed_start  timestamptz,
  p_proposed_end    timestamptz,
  p_location        text    default null,
  p_notes           text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller     uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
begin
  -- Must be authenticated
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  -- Input validation
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Title is required';
  end if;
  if p_proposed_start is null or p_proposed_end is null then
    raise exception 'Start and end times are required';
  end if;
  if p_proposed_end <= p_proposed_start then
    raise exception 'End time must be after start time';
  end if;

  -- Validate active partnership membership and resolve the other partner
  select pr.partner_id into v_partner_id
    from public.get_partnership_roles(p_partnership_id, v_caller) pr;

  if v_partner_id is null then
    raise exception 'Not a member of this active partnership';
  end if;

  -- 1) Insert proposal row
  insert into public.proposals
    (partnership_id, created_by, status, pending_actor_id, current_version)
  values
    (p_partnership_id, v_caller, 'proposed', v_partner_id, 1)
  returning id into v_proposal_id;

  -- 2) Insert first version
  insert into public.proposal_versions
    (proposal_id, version_number, created_by,
     title, location, proposed_start, proposed_end, notes)
  values
    (v_proposal_id, 1, v_caller,
     p_title, p_location, p_proposed_start, p_proposed_end, p_notes);

  -- 3) Insert audit action
  insert into public.proposal_actions
    (proposal_id, actor_id, action, version_number)
  values
    (v_proposal_id, v_caller, 'proposed', 1);

  return v_proposal_id;
end;
$$;

comment on function public.create_proposal is
  'Atomically creates a proposal with its first version and audit action. Security definer — bypasses RLS.';

-- -------------------------------------------------------
-- 2. join_partnership
-- -------------------------------------------------------
-- Validates invite code, prevents self-join and duplicate
-- active partnerships, activates atomically.
-- Uses FOR UPDATE to prevent concurrent join races.
-- -------------------------------------------------------

create or replace function public.join_partnership(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller         uuid := auth.uid();
  v_partnership_id uuid;
  v_partner_a_id   uuid;
begin
  -- Must be authenticated
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if p_invite_code is null or length(trim(p_invite_code)) = 0 then
    raise exception 'Invite code is required';
  end if;

  -- Lock the matching pending partnership row
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

  -- Cannot join your own partnership
  if v_partner_a_id = v_caller then
    raise exception 'Cannot join your own partnership';
  end if;

  -- Cannot join if already in a non-dissolved partnership
  if exists (
    select 1 from public.partnerships
     where status != 'dissolved'
       and (partner_a_id = v_caller or partner_b_id = v_caller)
  ) then
    raise exception 'You are already in an active partnership';
  end if;

  -- Activate the partnership
  update public.partnerships
     set partner_b_id = v_caller,
         status       = 'active'
   where id = v_partnership_id;

  return v_partnership_id;
end;
$$;

comment on function public.join_partnership is
  'Joins a partnership by invite code. Security definer — client never needs SELECT on pending partnerships.';

-- -------------------------------------------------------
-- 3. load_proposal_for_update
-- -------------------------------------------------------
-- Row-locking helper for the proposal-action Edge Function.
-- Acquires SELECT … FOR UPDATE to serialise concurrent
-- accept / counter / decline operations on the same proposal.
-- -------------------------------------------------------

create or replace function public.load_proposal_for_update(p_proposal_id uuid)
returns public.proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.proposals;
begin
  select * into v_row
    from public.proposals
   where id = p_proposal_id
     for update;

  if not found then
    raise exception 'Proposal not found: %', p_proposal_id;
  end if;

  return v_row;
end;
$$;

comment on function public.load_proposal_for_update is
  'Acquires a FOR UPDATE row lock on a proposal. Used by proposal-action Edge Function to prevent race conditions.';
