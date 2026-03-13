-- ============================================================================
-- HoneyCal: Database Functions (Schema Foundations)
-- ============================================================================
-- Triggers: handle_new_user, set_updated_at
-- Helpers: get_partnership_roles
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

