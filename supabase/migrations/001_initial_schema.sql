-- ============================================================================
-- HoneyCal: Initial Schema
-- ============================================================================
-- Tables: profiles, partnerships, google_calendar_connections,
--         proposals, proposal_versions, proposal_actions, calendar_events
-- ============================================================================

-- -------------------------------------------------------
-- Enums
-- -------------------------------------------------------

create type public.partnership_status as enum ('pending', 'active', 'dissolved');

create type public.proposal_status as enum (
  'proposed',
  'counter_proposed',
  'accepted',
  'finalized',
  'withdrawn',
  'declined',
  'cancelled'
);

create type public.proposal_action_type as enum (
  'proposed',
  'countered',
  'accepted',
  'declined',
  'withdrawn',
  'finalized',
  'cancelled'
);

create type public.calendar_sync_status as enum (
  'synced',
  'partial_failure',
  'pending_retry'
);

-- -------------------------------------------------------
-- 1. profiles
-- -------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  display_name  text not null,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

comment on table public.profiles is
  'One row per authenticated user. PK mirrors auth.users.id.';

-- -------------------------------------------------------
-- 2. partnerships
-- -------------------------------------------------------

create table public.partnerships (
  id            uuid primary key default gen_random_uuid(),
  partner_a_id  uuid not null references public.profiles(id),
  partner_b_id  uuid references public.profiles(id),
  invite_code   text not null unique default encode(gen_random_bytes(6), 'hex'),
  status        public.partnership_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.partnerships enable row level security;

-- Each user can be in at most one non-dissolved partnership (either role).
create unique index idx_partnerships_partner_a on public.partnerships (partner_a_id)
  where status != 'dissolved';
create unique index idx_partnerships_partner_b on public.partnerships (partner_b_id)
  where status != 'dissolved' and partner_b_id is not null;

comment on table public.partnerships is
  'Exactly one active partnership per user. partner_a creates, partner_b joins via invite code.';
comment on column public.partnerships.partner_b_id is
  'NULL until the second partner joins. Set on join, never changed.';

-- -------------------------------------------------------
-- 3. google_calendar_connections
-- -------------------------------------------------------

create table public.google_calendar_connections (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null unique references public.profiles(id) on delete cascade,
  access_token      text not null,
  refresh_token     text not null,
  token_expires_at  timestamptz not null,
  calendar_id       text not null default 'primary',
  scopes            text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;

comment on column public.google_calendar_connections.access_token is
  'Short-lived Google access token, encrypted at application level.';
comment on column public.google_calendar_connections.refresh_token is
  'Long-lived Google refresh token, encrypted at application level.';
comment on column public.google_calendar_connections.scopes is
  'Granted OAuth scopes, stored for re-consent detection.';

-- -------------------------------------------------------
-- 4. proposals
-- -------------------------------------------------------

create table public.proposals (
  id                uuid primary key default gen_random_uuid(),
  partnership_id    uuid not null references public.partnerships(id),
  created_by        uuid not null references public.profiles(id),
  status            public.proposal_status not null default 'proposed',
  pending_actor_id  uuid references public.profiles(id),
  current_version   int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint pending_actor_null_on_terminal check (
    (status in ('finalized', 'withdrawn', 'declined', 'cancelled') and pending_actor_id is null)
    or status not in ('finalized', 'withdrawn', 'declined', 'cancelled')
  ),
  constraint pending_actor_null_on_accepted check (
    (status = 'accepted' and pending_actor_id is null)
    or status != 'accepted'
  )
);

alter table public.proposals enable row level security;

create index idx_proposals_partnership on public.proposals (partnership_id);
create index idx_proposals_pending_actor on public.proposals (pending_actor_id)
  where pending_actor_id is not null;

comment on column public.proposals.pending_actor_id is
  'Who owes the next action. NULL on terminal states and accepted. Server-enforced.';
comment on column public.proposals.current_version is
  'Points to the latest proposal_versions.version_number. Denormalized for fast reads.';

-- -------------------------------------------------------
-- 5. proposal_versions
-- -------------------------------------------------------

create table public.proposal_versions (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.proposals(id) on delete cascade,
  version_number  int not null,
  created_by      uuid not null references public.profiles(id),
  title           text not null,
  location        text,
  proposed_start  timestamptz not null,
  proposed_end    timestamptz not null,
  notes           text,
  created_at      timestamptz not null default now(),

  unique (proposal_id, version_number),

  constraint valid_time_range check (proposed_end > proposed_start)
);

alter table public.proposal_versions enable row level security;

comment on table public.proposal_versions is
  'Immutable content snapshots. Created on propose and counter only. Never updated or deleted.';

-- -------------------------------------------------------
-- 6. proposal_actions
-- -------------------------------------------------------

create table public.proposal_actions (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.proposals(id) on delete cascade,
  actor_id        uuid references public.profiles(id),
  action          public.proposal_action_type not null,
  version_number  int,
  note            text,
  metadata        jsonb,
  created_at      timestamptz not null default now(),

  constraint version_required_for_content_actions check (
    (action in ('proposed', 'countered') and version_number is not null)
    or action not in ('proposed', 'countered')
  ),
  constraint system_actions_no_actor check (
    (action = 'finalized' and actor_id is null)
    or action != 'finalized'
  )
);

alter table public.proposal_actions enable row level security;

create index idx_proposal_actions_proposal on public.proposal_actions (proposal_id, created_at);

comment on table public.proposal_actions is
  'Append-only audit trail. One row per state transition. Never updated, never deleted.';

-- -------------------------------------------------------
-- 7. calendar_events
-- -------------------------------------------------------

create table public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null unique references public.proposals(id) on delete cascade,
  gcal_event_id_a   text,
  gcal_event_id_b   text,
  sync_status       public.calendar_sync_status not null default 'synced',
  last_sync_error   text,
  synced_at         timestamptz not null default now(),

  constraint at_least_one_gcal_id check (
    gcal_event_id_a is not null or gcal_event_id_b is not null
  )
);

alter table public.calendar_events enable row level security;

comment on table public.calendar_events is
  'Google Calendar event IDs for finalized proposals. One row per finalized proposal.';
