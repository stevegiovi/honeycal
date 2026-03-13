# HoneyCal — Backend Specification

> Concrete backend design: tables, constraints, RLS, transitions, Edge Functions.
> This is the implementation contract. Lock this before writing any UI.

---

## 1. SQL Table Definitions

### 1.1 profiles

```sql
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  display_name text not null,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

comment on table public.profiles is
  'One row per authenticated user. PK mirrors auth.users.id.';
```

**Trigger:** Auto-create profile row on sign-up via a database function hooked to `auth.users` insert.

```sql
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
```

### 1.2 partnerships

```sql
create type public.partnership_status as enum ('pending', 'active', 'dissolved');

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

-- Each user can be in at most one partnership (either role).
create unique index idx_partnerships_partner_a on public.partnerships (partner_a_id)
  where status != 'dissolved';
create unique index idx_partnerships_partner_b on public.partnerships (partner_b_id)
  where status != 'dissolved' and partner_b_id is not null;

comment on table public.partnerships is
  'Exactly one active partnership per user. partner_a is the creator, partner_b joins via invite code.';
comment on column public.partnerships.partner_b_id is
  'NULL until the second partner joins. Set on join, never changed.';
```

**Design note on partner_a / partner_b:** The `partner_a_id` / `partner_b_id` distinction exists only for storage. Application code must **never** branch on whether the current user is "a" or "b". All app logic uses a partnership helper (see Section 3) that resolves `me` and `partner` from the current user's perspective.

### 1.3 google_calendar_connections

```sql
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
  'Short-lived Google access token. Refreshed server-side before each API call.';
comment on column public.google_calendar_connections.refresh_token is
  'Long-lived Google refresh token. Used to obtain new access tokens.';
comment on column public.google_calendar_connections.scopes is
  'Granted OAuth scopes. Stored so we can detect if re-consent is needed after scope changes.';
```

**Encryption:** Access and refresh tokens should be encrypted at rest. Options:
1. **Supabase Vault / pgsodium** (preferred if available on the project's Supabase plan).
2. **Application-level encryption** in Edge Functions before writing, with key stored in Supabase secrets.

For MVP, we start with option 2 (application-level AES-256-GCM in Edge Functions) since it works on all Supabase plans. The `access_token` and `refresh_token` columns store ciphertext. Only Edge Functions (using `service_role`) can decrypt.

### 1.4 proposals

```sql
create type public.proposal_status as enum (
  'proposed',
  'counter_proposed',
  'accepted',
  'finalized',
  'withdrawn',
  'declined',
  'cancelled'
);

create table public.proposals (
  id                uuid primary key default gen_random_uuid(),
  partnership_id    uuid not null references public.partnerships(id),
  created_by        uuid not null references public.profiles(id),
  status            public.proposal_status not null default 'proposed',
  pending_actor_id  uuid references public.profiles(id),
  current_version   int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Structural constraints
  constraint fk_created_by_in_partnership check (true),  -- enforced by RLS + trigger
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
  'Who owes the next action. NULL on terminal states and accepted (system finalizes). Server-enforced.';
comment on column public.proposals.current_version is
  'Points to the latest proposal_versions.version_number. Denormalized for fast reads.';
```

### 1.5 proposal_versions

```sql
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

  -- Every version must represent a concrete time range
  constraint valid_time_range check (proposed_end > proposed_start)
);

alter table public.proposal_versions enable row level security;

comment on table public.proposal_versions is
  'Immutable content snapshots. Created on propose and counter only. Never updated or deleted.';
comment on constraint valid_time_range on public.proposal_versions is
  'Every saved version has a concrete start < end. No open-ended or tentative versions.';
```

### 1.6 proposal_actions

```sql
create type public.proposal_action_type as enum (
  'proposed',
  'countered',
  'accepted',
  'declined',
  'withdrawn',
  'finalized',
  'cancelled'
);

create table public.proposal_actions (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.proposals(id) on delete cascade,
  actor_id        uuid references public.profiles(id),
  action          public.proposal_action_type not null,
  version_number  int,
  note            text,
  metadata        jsonb,
  created_at      timestamptz not null default now(),

  -- version_number required for actions that create versions
  constraint version_required_for_content_actions check (
    (action in ('proposed', 'countered') and version_number is not null)
    or (action not in ('proposed', 'countered'))
  ),
  -- system actions have null actor
  constraint system_actions_no_actor check (
    (action = 'finalized' and actor_id is null)
    or action != 'finalized'
  )
);

alter table public.proposal_actions enable row level security;

create index idx_proposal_actions_proposal on public.proposal_actions (proposal_id, created_at);

comment on table public.proposal_actions is
  'Append-only audit trail. One row per state transition. Never updated, never deleted.';
comment on column public.proposal_actions.actor_id is
  'NULL for system-triggered actions (finalized). Set for all user-triggered actions.';
comment on column public.proposal_actions.version_number is
  'Set for proposed/countered (they create versions). NULL for accept/decline/withdraw/cancel.';
```

### 1.7 calendar_events

```sql
create type public.calendar_sync_status as enum (
  'synced',
  'partial_failure',
  'pending_retry'
);

create table public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null unique references public.proposals(id) on delete cascade,
  gcal_event_id_a   text,
  gcal_event_id_b   text,
  sync_status       public.calendar_sync_status not null default 'synced',
  last_sync_error   text,
  synced_at         timestamptz not null default now(),

  -- At least one must be set if the row exists
  constraint at_least_one_gcal_id check (
    gcal_event_id_a is not null or gcal_event_id_b is not null
  )
);

alter table public.calendar_events enable row level security;

comment on table public.calendar_events is
  'Stores Google Calendar event IDs for finalized proposals. One row per finalized proposal.';
comment on column public.calendar_events.sync_status is
  'synced = both calendars written. partial_failure = one write failed. pending_retry = retry queued.';
comment on column public.calendar_events.last_sync_error is
  'Human-readable error from the last failed sync attempt. NULL when synced.';
```

### 1.8 updated_at trigger (shared)

```sql
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
```

---

## 2. Row-Level Security Policies

### 2.1 profiles

```sql
-- Users can read their own profile
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Users can read their partner's profile (for display name, avatar)
create policy "Users can read partner profile"
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
```

### 2.2 partnerships

```sql
-- Users can read partnerships they belong to
create policy "Users can read own partnerships"
  on public.partnerships for select
  using (partner_a_id = auth.uid() or partner_b_id = auth.uid());

-- Users can create a partnership (as partner_a)
create policy "Users can create partnerships"
  on public.partnerships for insert
  with check (partner_a_id = auth.uid() and partner_b_id is null);

-- Users can join a partnership (set partner_b_id) — handled via Edge Function with service_role.
-- No direct update policy for partner_b_id from client.

-- Anyone can read a pending partnership by invite code (for joining).
-- This is scoped: they can only see the row, not modify it.
create policy "Anyone can read pending partnership by invite code"
  on public.partnerships for select
  using (status = 'pending');
```

### 2.3 google_calendar_connections

```sql
-- Users can read their own connection
create policy "Users can read own calendar connection"
  on public.google_calendar_connections for select
  using (profile_id = auth.uid());

-- Users can delete their own connection (disconnect)
create policy "Users can delete own calendar connection"
  on public.google_calendar_connections for delete
  using (profile_id = auth.uid());

-- Insert and update handled by Edge Functions (service_role) only.
-- Client never writes tokens directly.
```

### 2.4 proposals

```sql
-- Helper function: check if user is a member of the partnership
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

-- Users can read proposals in their partnership
create policy "Users can read partnership proposals"
  on public.proposals for select
  using (public.is_partnership_member(partnership_id));

-- Users can insert proposals in their partnership
create policy "Users can create proposals"
  on public.proposals for insert
  with check (
    public.is_partnership_member(partnership_id)
    and created_by = auth.uid()
  );

-- Updates to proposals are done via Edge Functions (service_role) to enforce
-- state machine rules. No direct update policy from client.
```

### 2.5 proposal_versions

```sql
-- Users can read versions for proposals in their partnership
create policy "Users can read proposal versions"
  on public.proposal_versions for select
  using (
    exists (
      select 1 from public.proposals p
      where p.id = proposal_id
        and public.is_partnership_member(p.partnership_id)
    )
  );

-- Users can insert versions (via proposal creation / counter)
create policy "Users can create proposal versions"
  on public.proposal_versions for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.proposals p
      where p.id = proposal_id
        and public.is_partnership_member(p.partnership_id)
    )
  );

-- Versions are immutable: no update or delete policies.
```

### 2.6 proposal_actions

```sql
-- Users can read actions for proposals in their partnership
create policy "Users can read proposal actions"
  on public.proposal_actions for select
  using (
    exists (
      select 1 from public.proposals p
      where p.id = proposal_id
        and public.is_partnership_member(p.partnership_id)
    )
  );

-- Insert handled by Edge Functions (service_role) to ensure action validity.
-- No direct insert from client.

-- Actions are immutable: no update or delete policies.
```

### 2.7 calendar_events

```sql
-- Users can read calendar events for proposals in their partnership
create policy "Users can read calendar events"
  on public.calendar_events for select
  using (
    exists (
      select 1 from public.proposals p
      where p.id = proposal_id
        and public.is_partnership_member(p.partnership_id)
    )
  );

-- Insert, update, delete handled by Edge Functions (service_role) only.
```

---

## 3. Partnership Helper Design

Application code (both Edge Functions and client-side hooks) must never branch on `partner_a_id` vs `partner_b_id`. Instead, all code uses a helper that resolves roles from the current user's perspective.

### Database function (used in Edge Functions)

```sql
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
```

### TypeScript helper (used in client hooks)

```typescript
// lib/partnership.ts
interface PartnershipRoles {
  meId: string;
  partnerId: string;
}

function getPartnershipRoles(
  partnership: { partner_a_id: string; partner_b_id: string },
  currentUserId: string
): PartnershipRoles {
  if (partnership.partner_a_id === currentUserId) {
    return { meId: partnership.partner_a_id, partnerId: partnership.partner_b_id };
  }
  return { meId: partnership.partner_b_id, partnerId: partnership.partner_a_id };
}
```

**Rule:** No other code in the app should reference `partner_a_id` or `partner_b_id` directly. All access goes through these helpers.

---

## 4. Server-Owned State Transitions

All proposal state transitions are enforced server-side. The client sends intent; the server validates and executes.

### 4.1 Transition Matrix

```
From               → To                  Actor Constraint           Creates Version?
─────────────────────────────────────────────────────────────────────────────────────
proposed           → accepted            pending_actor only         No
proposed           → counter_proposed    pending_actor only         Yes
proposed           → declined            pending_actor only         No
proposed           → withdrawn           either partner             No
counter_proposed   → accepted            pending_actor only         No
counter_proposed   → counter_proposed    pending_actor only         Yes
counter_proposed   → declined            pending_actor only         No
counter_proposed   → withdrawn           either partner             No
accepted           → finalized           SERVER ONLY                No
finalized          → cancelled           either partner             No
```

### 4.2 The `accepted → finalized` Transition

This is **strictly server-owned**. The flow:

1. Client calls Edge Function `proposal-action` with `action: 'accept'`.
2. Edge Function validates: caller is `pending_actor_id`, status is `proposed` or `counter_proposed`.
3. Edge Function sets `status = 'accepted'`, `pending_actor_id = NULL`.
4. Edge Function records action: `{action: 'accepted', actor_id: caller}`.
5. Edge Function **immediately** attempts finalization within the same request:
   a. Reads the current version's details.
   b. Reads both partners' Google Calendar tokens.
   c. Creates event in Partner A's calendar.
   d. Creates event in Partner B's calendar.
   e. If **both succeed**: sets `status = 'finalized'`, inserts `calendar_events` row with `sync_status = 'synced'`, records action `{action: 'finalized', actor_id: NULL}`.
   f. If **one or both fail**: see Section 5 (failure handling). Status may stay `accepted` or move to `finalized` with `partial_failure`.
6. Edge Function returns the final state to the client.

**Why the server owns this:** The client never sets `status = 'finalized'`. Only the Edge Function can, and only after confirming both calendar writes (or recording a partial failure state). There is no client-side "finalize" button — acceptance triggers finalization automatically.

### 4.3 Validation Rules (enforced in `proposal-action` Edge Function)

```
For every action request:
  1. Authenticate caller (JWT verification)
  2. Load proposal + partnership
  3. Verify caller is a member of the partnership
  4. Verify current status allows the requested transition (transition matrix)
  5. Verify actor constraint:
     - accept/counter/decline: caller must equal pending_actor_id
     - withdraw: caller must be partner_a or partner_b
     - cancel: caller must be partner_a or partner_b, status must be 'finalized'
  6. If counter: validate version payload (title required, proposed_start < proposed_end)
  7. Execute transition atomically (single transaction):
     - Update proposals row (status, pending_actor_id, current_version)
     - Insert proposal_version (if counter)
     - Insert proposal_action
     - If accept → attempt finalization (step 4.2.5)
  8. Return updated proposal + latest version + new action
```

### 4.4 Pending Actor Computation

```
On 'proposed':
  pending_actor_id = partner who is NOT created_by

On 'countered':
  pending_actor_id = partner who is NOT the counter's created_by
  (i.e., flip from whoever just countered to the other partner)

On 'accepted', 'finalized', 'declined', 'withdrawn', 'cancelled':
  pending_actor_id = NULL
```

---

## 5. Cancellation Failure & Retry Design

### 5.1 Finalization Failure Handling

When acceptance triggers finalization (Section 4.2.5):

```
Case 1: Both GCal writes succeed
  → status = 'finalized'
  → calendar_events.sync_status = 'synced'
  → calendar_events.gcal_event_id_a = <id>, gcal_event_id_b = <id>

Case 2: Partner A write succeeds, Partner B write fails
  → status = 'finalized'
  → calendar_events.sync_status = 'partial_failure'
  → calendar_events.gcal_event_id_a = <id>, gcal_event_id_b = NULL
  → calendar_events.last_sync_error = 'Failed to write to Partner B calendar: <error>'
  → Client shows: "Event created but sync to [partner name]'s calendar failed. Tap to retry."

Case 3: Partner A write fails (Partner B not attempted)
  → status stays 'accepted'
  → No calendar_events row created
  → No 'finalized' action recorded
  → Client shows: "Calendar sync failed. Tap to retry."
  → Client can re-call the Edge Function to retry (idempotent attempt)

Case 4: Both writes fail
  → Same as Case 3
```

**Key rule:** Status only moves to `finalized` if at least one calendar write succeeded. If zero writes succeeded, status stays `accepted` and the user retries.

### 5.2 Finalization Retry

The `proposal-action` Edge Function handles retry for `accepted` proposals:
- Client calls with `action: 'retry_finalize'` (special action, not a state transition).
- Edge Function verifies status is `accepted` (Case 3/4) or `finalized` with `sync_status = 'partial_failure'` (Case 2).
- Re-attempts the failed write(s) only.
- Updates `calendar_events` row accordingly.

### 5.3 Cancellation Failure Handling

When either partner cancels a finalized event:

```
Step 1: Delete from Partner A's Google Calendar
Step 2: Delete from Partner B's Google Calendar
Step 3: Update proposal status and record action

Failure scenarios:

Case 1: Both deletes succeed
  → status = 'cancelled'
  → calendar_events row updated: gcal_event_id_a = NULL, gcal_event_id_b = NULL
  → Action recorded: {action: 'cancelled', actor_id: caller}

Case 2: Partner A delete succeeds, Partner B delete fails
  → status = 'cancelled' (we commit to cancellation intent)
  → calendar_events.sync_status = 'partial_failure'
  → calendar_events.gcal_event_id_a = NULL (cleared, was deleted)
  → calendar_events.gcal_event_id_b = <still set> (delete failed)
  → calendar_events.last_sync_error = 'Failed to delete from [partner name] calendar: <error>'
  → Action recorded: {action: 'cancelled', actor_id: caller, metadata: {partial_failure: true}}
  → Client shows: "Event cancelled but removal from [partner name]'s calendar failed.
                   They may need to remove it manually."

Case 3: Partner A delete fails (Partner B not attempted)
  → Still attempt Partner B delete (don't short-circuit)
  → Then handle based on combined results:
    - If B succeeded: same as Case 2 but reversed
    - If both failed:
      → status stays 'finalized'
      → No action recorded
      → Client shows: "Cancellation failed. Both calendar deletions failed. Tap to retry."

Case 4: Google API returns 404/410 (event already deleted externally)
  → Treat as success for that calendar. The event is gone, which is the desired state.
```

**Key rules for cancellation:**
1. Always attempt both deletes, even if the first fails.
2. Cancellation is committed (status = `cancelled`) if at least one delete succeeds.
3. If both deletes fail, status stays `finalized` — user retries.
4. 404/410 from Google = success (idempotent).

### 5.4 Cancellation Retry

Same pattern as finalization retry:
- Client calls `proposal-action` with `action: 'retry_cancel'`.
- Edge Function re-attempts only the failed delete(s).
- Updates `calendar_events` accordingly.

---

## 6. Edge Function Specifications

### 6.1 Overview

| Function | Auth | Purpose | Writes to DB? |
|----------|------|---------|---------------|
| `google-auth-callback` | User JWT | Exchange Google auth code for tokens, store encrypted | Yes |
| `google-refresh-token` | Service (internal) | Refresh expired access token | Yes |
| `generate-slots` | User JWT | Query both calendars, return conflict-free slots | No |
| `check-conflicts` | User JWT | Check conflicts for a specific time window | No |
| `proposal-action` | User JWT | Execute any proposal state transition | Yes |
| `cancel-event` | User JWT | Delete event from both GCals, cancel proposal | Yes |

### 6.2 `google-auth-callback`

```
POST /functions/v1/google-auth-callback

Request:
  { code: string }              // Authorization code from Google OAuth

Auth: Bearer <supabase_jwt>

Steps:
  1. Verify JWT, extract user_id
  2. Exchange code for tokens via Google token endpoint
  3. Verify granted scopes include required scopes (see Section 7)
  4. Encrypt access_token and refresh_token (AES-256-GCM)
  5. Upsert into google_calendar_connections
  6. Return { success: true, calendar_id: 'primary' }

Errors:
  400 — invalid or expired code
  401 — invalid JWT
  403 — insufficient Google scopes granted
```

### 6.3 `generate-slots`

```
POST /functions/v1/generate-slots

Request:
  {
    date_range_start: string,   // ISO date (e.g., "2026-03-14")
    date_range_end: string,     // ISO date (e.g., "2026-03-21")
    time_window_start: string,  // HH:MM (e.g., "17:00") — optional
    time_window_end: string,    // HH:MM (e.g., "22:00") — optional
    duration_minutes: number    // e.g., 120
  }

Auth: Bearer <supabase_jwt>

Steps:
  1. Verify JWT, extract user_id
  2. Load partnership, get both partner IDs (via get_partnership_roles)
  3. Load both partners' Google Calendar tokens (service_role), decrypt
  4. Refresh tokens if expired
  5. Call Google Calendar freebusy API for both partners across date range
  6. Compute conflict-free slots of requested duration within time window
  7. Return ordered list of candidate slots

Response:
  {
    slots: [
      { start: "2026-03-15T18:00:00Z", end: "2026-03-15T20:00:00Z" },
      { start: "2026-03-16T19:00:00Z", end: "2026-03-16T21:00:00Z" },
      ...
    ]
  }

Errors:
  400 — invalid input (date range, duration)
  401 — invalid JWT
  403 — user not in an active partnership
  424 — one or both calendar connections missing/broken
```

### 6.4 `check-conflicts`

```
POST /functions/v1/check-conflicts

Request:
  {
    proposed_start: string,     // ISO datetime
    proposed_end: string        // ISO datetime
  }

Auth: Bearer <supabase_jwt>

Steps:
  1. Verify JWT, extract user_id
  2. Load partnership, get both partner IDs
  3. Load both partners' Google Calendar tokens, decrypt
  4. Refresh tokens if expired
  5. Call Google Calendar freebusy API for both partners at proposed time
  6. Return conflict info per partner

Response:
  {
    me: { has_conflict: false, conflicts: [] },
    partner: {
      has_conflict: true,
      conflicts: [
        { start: "2026-03-15T18:00:00Z", end: "2026-03-15T19:00:00Z", summary: "Team standup" }
      ]
    }
  }

Errors:
  400 — invalid input
  401 — invalid JWT
  403 — user not in active partnership
  424 — calendar connection missing/broken
```

**Note on conflict summary:** Google freebusy API does not return event titles. To show `summary`, we would need `calendar.events.list` with the broader scope. For MVP, return `has_conflict: true/false` and busy time ranges only — no titles. This keeps scopes minimal.

### 6.5 `proposal-action`

This is the **single entry point** for all proposal state transitions.

```
POST /functions/v1/proposal-action

Request (accept):
  { proposal_id: string, action: "accept" }

Request (counter):
  {
    proposal_id: string,
    action: "counter",
    version: {
      title: string,
      location?: string,
      proposed_start: string,    // ISO datetime, concrete
      proposed_end: string,      // ISO datetime, concrete
      notes?: string
    }
  }

Request (decline):
  { proposal_id: string, action: "decline", note?: string }

Request (withdraw):
  { proposal_id: string, action: "withdraw", note?: string }

Request (retry_finalize):
  { proposal_id: string, action: "retry_finalize" }

Auth: Bearer <supabase_jwt>

Steps: See Section 4.3 (validation rules)

Response:
  {
    proposal: { ...updated proposal },
    version: { ...current version },
    action: { ...recorded action },
    calendar_event?: { ...if finalized }
  }

Errors:
  400 — invalid input, invalid transition
  401 — invalid JWT
  403 — not pending actor, not in partnership
  409 — proposal status has changed (concurrent modification)
  424 — calendar sync failed (on accept → finalize)
```

**Concurrency:** The Edge Function uses `SELECT ... FOR UPDATE` on the proposals row to prevent race conditions when both partners act simultaneously.

### 6.6 `cancel-event`

```
POST /functions/v1/cancel-event

Request:
  { proposal_id: string }

Auth: Bearer <supabase_jwt>

Steps: See Section 5.3 (cancellation failure handling)

Response:
  {
    proposal: { ...updated proposal },
    action: { ...recorded action },
    calendar_event: { ...updated sync status }
  }

Errors:
  400 — proposal is not finalized
  401 — invalid JWT
  403 — user not in partnership
  424 — both calendar deletes failed (status stays finalized)
```

### 6.7 Create-proposal flow

Proposal creation is handled **client-side via Supabase SDK** (not an Edge Function), since it's a straightforward insert within RLS:

```
Client-side steps:
  1. Insert into proposals (partnership_id, created_by, status='proposed', pending_actor_id=partner_id, current_version=1)
  2. Insert into proposal_versions (proposal_id, version_number=1, created_by, title, location, proposed_start, proposed_end, notes)
  3. Insert into proposal_actions (proposal_id, actor_id=me, action='proposed', version_number=1)

All three inserts in a single Supabase RPC call or transaction.
```

**Alternative:** If we need atomicity guarantees stronger than what the client SDK provides, wrap this in a Postgres function:

```sql
create or replace function public.create_proposal(
  p_partnership_id uuid,
  p_title text,
  p_location text,
  p_proposed_start timestamptz,
  p_proposed_end timestamptz,
  p_notes text
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
  -- Get partner ID
  select partner_id into v_partner_id
  from public.get_partnership_roles(p_partnership_id, v_user_id);

  if v_partner_id is null then
    raise exception 'Not a member of this partnership';
  end if;

  -- Insert proposal
  insert into public.proposals (partnership_id, created_by, status, pending_actor_id, current_version)
  values (p_partnership_id, v_user_id, 'proposed', v_partner_id, 1)
  returning id into v_proposal_id;

  -- Insert version
  insert into public.proposal_versions (proposal_id, version_number, created_by, title, location, proposed_start, proposed_end, notes)
  values (v_proposal_id, 1, v_user_id, p_title, p_location, p_proposed_start, p_proposed_end, p_notes);

  -- Insert action
  insert into public.proposal_actions (proposal_id, actor_id, action, version_number)
  values (v_proposal_id, v_user_id, 'proposed', 1);

  return v_proposal_id;
end;
$$;
```

---

## 7. Google Calendar OAuth Scopes

### Minimum required scopes

| Scope | Purpose | Used by |
|-------|---------|---------|
| `https://www.googleapis.com/auth/calendar.freebusy` | Read free/busy info for conflict detection and slot generation | `generate-slots`, `check-conflicts` |
| `https://www.googleapis.com/auth/calendar.events.owned` | Create and delete events owned by the app | `proposal-action` (finalize), `cancel-event` |

### Scopes NOT requested

| Scope | Why excluded |
|-------|-------------|
| `https://www.googleapis.com/auth/calendar` | Full read/write — too broad. We don't need to read/edit events we didn't create. |
| `https://www.googleapis.com/auth/calendar.events` | Read/write all events — more than needed. `events.owned` covers create/delete for our events. |
| `https://www.googleapis.com/auth/calendar.readonly` | We don't need to read event details. Freebusy is sufficient for conflict detection. |

### Scope verification

On token exchange (`google-auth-callback`), verify the granted scopes include both required scopes. If the user declined a scope, return an error explaining which permission is missing and why it's needed.

Store granted scopes in `google_calendar_connections.scopes` so that if we change required scopes in the future, we can detect which users need to re-consent.

---

## 8. Backend Implementation Order

Each step must be **testable independently** before moving to the next.

### Step 1: Database Schema + RLS

**Deliver:**
- Migration file `001_initial_schema.sql` with all tables, enums, constraints, indexes
- Migration file `002_rls_policies.sql` with all RLS policies
- Migration file `003_functions.sql` with helper functions (`handle_new_user`, `set_updated_at`, `get_partnership_roles`, `is_partnership_member`, `create_proposal`)

**Test:**
- Manually create two users via Supabase Auth dashboard
- Verify profile auto-creation trigger
- Verify RLS: user A cannot read user B's calendar connection
- Verify RLS: user A cannot read proposals from a partnership they don't belong to
- Verify `create_proposal` function works and enforces constraints

### Step 2: Partnership Join Flow

**Deliver:**
- The `create_proposal` function from Step 1 already covers proposal creation
- Edge Function or Postgres function for `join_partnership`:
  - Input: invite_code
  - Validates: partnership exists, status is pending, partner_b_id is null, caller is not already in a partnership
  - Sets partner_b_id = caller, status = 'active'

**Test:**
- User A creates partnership → gets invite code
- User B joins with invite code → partnership becomes active
- User B tries to join another → rejected
- User C tries to join with same code → rejected (already active)

### Step 3: Google Calendar Connection

**Deliver:**
- Edge Function: `google-auth-callback` (token exchange + encryption + storage)
- Edge Function: `google-refresh-token` (internal helper, called by other functions)
- Token encryption/decryption utility module (shared across Edge Functions)

**Test:**
- Complete Google OAuth flow manually
- Verify tokens stored encrypted
- Verify token refresh works when access token expires
- Verify scope verification rejects insufficient scopes

### Step 4: Slot Generation + Conflict Check

**Deliver:**
- Edge Function: `generate-slots`
- Edge Function: `check-conflicts`

**Test:**
- Both partners connected to Google Calendar
- Call `generate-slots` with a date range → get back conflict-free slots
- Create a Google Calendar event manually → verify `check-conflicts` detects it
- Test with one partner's connection missing → get 424 error

### Step 5: Proposal State Machine

**Deliver:**
- Edge Function: `proposal-action` (accept, counter, decline, withdraw)
- All transition validation rules
- Pending actor enforcement
- Concurrency handling (SELECT FOR UPDATE)

**Test for each transition:**
- Propose → accept (by pending actor) → verify status and action recorded
- Propose → counter (by pending actor) → verify new version, flipped pending_actor
- Propose → decline (by pending actor) → verify terminal state
- Propose → withdraw (by either partner) → verify terminal state
- Counter → accept → verify status
- Counter → counter → counter → accept → verify multi-round negotiation
- Verify non-pending-actor cannot accept/counter/decline (403)
- Verify concurrent modifications are handled (409)

### Step 6: Finalization + Calendar Sync

**Deliver:**
- Finalization logic within `proposal-action` (triggered on accept)
- Calendar event creation for both partners
- `calendar_events` row creation
- Failure handling (Cases 1-4 from Section 5.1)
- `retry_finalize` action

**Test:**
- Accept a proposal → verify events appear in both Google Calendars
- Accept with one calendar broken → verify partial_failure state
- Retry finalize → verify the failed write is retried
- Accept with both calendars broken → verify status stays accepted

### Step 7: Cancellation

**Deliver:**
- Edge Function: `cancel-event`
- Failure handling (Cases 1-4 from Section 5.3)
- `retry_cancel` action

**Test:**
- Cancel a finalized event → verify deleted from both Google Calendars
- Cancel with one calendar broken → verify partial_failure, status still cancelled
- Cancel with both broken → verify status stays finalized
- Cancel an already-deleted event (404 from Google) → treated as success

---

## 9. Shared Edge Function Utilities

These are shared modules imported by multiple Edge Functions, not standalone functions.

```
supabase/functions/_shared/
├── auth.ts              # JWT verification, extract user_id
├── cors.ts              # CORS headers for all functions
├── crypto.ts            # AES-256-GCM encrypt/decrypt for tokens
├── errors.ts            # Standardized error response format
├── google-calendar.ts   # Google Calendar API client wrapper
│                        #   - freebusy query
│                        #   - create event
│                        #   - delete event
│                        #   - token refresh
├── partnership.ts       # Load partnership, resolve roles (me/partner)
├── supabase-admin.ts    # Supabase client with service_role key
└── types.ts             # Shared TypeScript types for Edge Functions
```

**`google-calendar.ts` token refresh pattern:**

```typescript
async function withValidToken(
  profileId: string,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  const conn = await loadConnection(profileId);
  if (isExpired(conn.token_expires_at)) {
    const refreshed = await refreshAccessToken(conn.refresh_token);
    await updateConnection(profileId, refreshed);
    return fn(refreshed.access_token);
  }
  return fn(decrypt(conn.access_token));
}
```

All Google API calls go through `withValidToken` to ensure automatic refresh.
