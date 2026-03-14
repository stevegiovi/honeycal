-- ============================================================================
-- HoneyCal: Backend RPCs
-- ============================================================================
-- Functions: create_proposal, join_partnership, load_proposal_for_update
-- All are SECURITY DEFINER with search_path = '' to prevent search_path hijack.
-- ============================================================================

-- -------------------------------------------------------
-- create_proposal
-- Atomically inserts proposals + proposal_versions + proposal_actions.
-- Caller must be an active member of the target partnership.
-- Sets pending_actor_id to the partner (not the creator).
-- -------------------------------------------------------

create or replace function public.create_proposal(
  p_partnership_id   uuid,
  p_title            text,
  p_proposed_start   timestamptz,
  p_proposed_end     timestamptz,
  p_location         text default null,
  p_notes            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal_id  uuid;
  v_partner_id   uuid;
  v_caller_id    uuid := auth.uid();
begin
  -- Verify active membership and resolve the other partner's id.
  select
    case
      when partner_a_id = v_caller_id then partner_b_id
      else partner_a_id
    end
  into v_partner_id
  from public.partnerships
  where id = p_partnership_id
    and status = 'active'
    and (partner_a_id = v_caller_id or partner_b_id = v_caller_id);

  if v_partner_id is null then
    raise exception 'Not a member of an active partnership with id %', p_partnership_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Insert proposal row (pending_actor = partner, i.e. they owe the next action).
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

  -- Insert immutable version snapshot.
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

  -- Append audit trail entry.
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

-- -------------------------------------------------------
-- join_partnership
-- Validates an invite code and activates the partnership atomically.
-- Guards:
--   - invite code must match a pending partnership
--   - caller cannot be the creator (no self-join)
--   - caller must not already have a non-dissolved partnership
-- Uses SELECT FOR UPDATE to prevent concurrent joins on the same invite.
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
  v_partnership_id  uuid;
  v_partner_a_id    uuid;
  v_caller_id       uuid := auth.uid();
begin
  -- Lock the matching pending row to prevent race conditions.
  select id, partner_a_id
  into v_partnership_id, v_partner_a_id
  from public.partnerships
  where invite_code = p_invite_code
    and status = 'pending'
  for update;

  if v_partnership_id is null then
    raise exception 'Invalid or already-used invite code'
      using errcode = 'no_data_found';
  end if;

  -- Prevent self-join.
  if v_partner_a_id = v_caller_id then
    raise exception 'Cannot join your own partnership invitation'
      using errcode = 'check_violation';
  end if;

  -- Prevent joining when the caller already has a non-dissolved partnership.
  if exists (
    select 1 from public.partnerships
    where status != 'dissolved'
      and (partner_a_id = v_caller_id or partner_b_id = v_caller_id)
  ) then
    raise exception 'You are already in an active or pending partnership'
      using errcode = 'unique_violation';
  end if;

  -- Activate the partnership.
  update public.partnerships
  set partner_b_id = v_caller_id,
      status       = 'active'
  where id = v_partnership_id;

  return v_partnership_id;
end;
$$;

-- -------------------------------------------------------
-- load_proposal_for_update
-- Returns the proposal row under a SELECT FOR UPDATE lock.
-- Intended for use by Edge Functions that need to perform an
-- atomic read-then-write on a proposal (e.g. state transitions).
-- Caller must be an active member of the proposal's partnership.
-- -------------------------------------------------------

create or replace function public.load_proposal_for_update(
  p_proposal_id uuid
)
returns public.proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        public.proposals;
  v_caller_id  uuid := auth.uid();
begin
  select p.*
  into v_row
  from public.proposals p
  join public.partnerships ps on ps.id = p.partnership_id
  where p.id = p_proposal_id
    and ps.status = 'active'
    and (ps.partner_a_id = v_caller_id or ps.partner_b_id = v_caller_id)
  for update of p;

  if v_row.id is null then
    raise exception 'Proposal not found or access denied for id %', p_proposal_id
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;
