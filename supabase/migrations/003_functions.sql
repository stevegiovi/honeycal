-- ============================================================================
-- HoneyCal: Database Functions
-- ============================================================================
-- Triggers: handle_new_user, set_updated_at
-- Helpers: get_partnership_roles
-- RPCs: create_proposal, join_partnership
-- ============================================================================

-- -------------------------------------------------------
-- Trigger: auto-create profile on sign-up
-- -------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------
-- Trigger: auto-update updated_at
-- -------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.partnerships
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.google_calendar_connections
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.proposals
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------
-- Helper: resolve partnership roles (me/partner)
-- -------------------------------------------------------

create or replace function public.get_partnership_roles(p_partnership_id uuid, p_user_id uuid)
returns table (me_id uuid, partner_id uuid)
language sql
stable
as $$
  select
    case
      when partner_a_id = p_user_id then partner_a_id
      else partner_b_id
    end as me_id,
    case
      when partner_a_id = p_user_id then partner_b_id
      else partner_a_id
    end as partner_id
  from public.partnerships
  where id = p_partnership_id
    and status = 'active'
    and (partner_a_id = p_user_id or partner_b_id = p_user_id);
$$;

-- -------------------------------------------------------
-- RPC: create_proposal
-- Atomic insert across proposals + proposal_versions + proposal_actions.
-- -------------------------------------------------------

create or replace function public.create_proposal(
  p_partnership_id uuid,
  p_title text,
  p_location text default null,
  p_proposed_start timestamptz default null,
  p_proposed_end timestamptz default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_proposal_id uuid;
  v_partner_id uuid;
  v_user_id uuid := auth.uid();
begin
  -- Validate required fields
  if p_title is null or trim(p_title) = '' then
    raise exception 'Title is required';
  end if;

  if p_proposed_start is null or p_proposed_end is null then
    raise exception 'Proposed start and end times are required';
  end if;

  if p_proposed_end <= p_proposed_start then
    raise exception 'proposed_end must be after proposed_start';
  end if;

  -- Get partner ID (also validates active partnership membership)
  select partner_id into v_partner_id
  from public.get_partnership_roles(p_partnership_id, v_user_id);

  if v_partner_id is null then
    raise exception 'Not a member of an active partnership';
  end if;

  -- Insert proposal
  insert into public.proposals (
    partnership_id, created_by, status, pending_actor_id, current_version
  )
  values (p_partnership_id, v_user_id, 'proposed', v_partner_id, 1)
  returning id into v_proposal_id;

  -- Insert version 1
  insert into public.proposal_versions (
    proposal_id, version_number, created_by,
    title, location, proposed_start, proposed_end, notes
  )
  values (
    v_proposal_id, 1, v_user_id,
    p_title, p_location, p_proposed_start, p_proposed_end, p_notes
  );

  -- Insert action
  insert into public.proposal_actions (
    proposal_id, actor_id, action, version_number
  )
  values (v_proposal_id, v_user_id, 'proposed', 1);

  return v_proposal_id;
end;
$$;

-- -------------------------------------------------------
-- RPC: join_partnership
-- Validates invite code, checks user not already in partnership,
-- sets partner_b and activates.
-- -------------------------------------------------------

create or replace function public.join_partnership(p_invite_code text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_partnership_id uuid;
  v_partner_a_id uuid;
  v_user_id uuid := auth.uid();
begin
  if p_invite_code is null or trim(p_invite_code) = '' then
    raise exception 'Invite code is required';
  end if;

  -- Find pending partnership by invite code (lock row to prevent race)
  select id, partner_a_id into v_partnership_id, v_partner_a_id
  from public.partnerships
  where invite_code = p_invite_code
    and status = 'pending'
    and partner_b_id is null
  for update;

  if v_partnership_id is null then
    raise exception 'Invalid or expired invite code';
  end if;

  -- Cannot join your own partnership
  if v_partner_a_id = v_user_id then
    raise exception 'Cannot join your own partnership';
  end if;

  -- Check user is not already in a non-dissolved partnership
  if exists (
    select 1 from public.partnerships
    where status != 'dissolved'
      and (partner_a_id = v_user_id or partner_b_id = v_user_id)
  ) then
    raise exception 'Already in a partnership';
  end if;

  -- Join: set partner_b and activate
  update public.partnerships
  set partner_b_id = v_user_id, status = 'active'
  where id = v_partnership_id;

  return v_partnership_id;
end;
$$;
