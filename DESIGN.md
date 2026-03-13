# HoneyCal — Design Document

> Private two-person event coordination app for partners.
> One job: propose, negotiate, finalize events into both Google Calendars.

---

## 1. Product Spec

### What HoneyCal Is

A mobile app for exactly two linked partners. Either partner proposes an event, the app checks both Google Calendars for conflicts, generates candidate time slots, supports a structured negotiation flow to agree on time/details, and writes the finalized event to both calendars. Voice input is available as an accelerator for proposal creation but is not required for any core flow.

### What HoneyCal Is Not

- Not a chat app
- Not a task manager
- Not a family/group organizer
- Not a general-purpose calendar app
- Not a social platform

### Core Principles

1. **Two users, one partnership.** The data model never accommodates more.
2. **Database is truth.** Local device state is a cache, never canonical.
3. **Deterministic fetch/mutation flows.** The app must work correctly through explicit data fetching and mutation. No flow depends on realtime subscriptions or push notifications for correctness.
4. **Low friction.** Every screen earns its existence. No settings mazes.
5. **Google Calendar is the external system of record.** HoneyCal reads/writes GCal but never replaces it.
6. **Narrow scope, clean extension points.** Ship the small thing correctly.
7. **Voice is an accelerator, not a dependency.** Every action reachable via voice must be reachable via manual input first.

---

## 2. Core User Journeys

### Journey 1: Partner Onboarding

1. User A signs up (Supabase Auth via email/password).
2. User A connects Google Calendar (OAuth2 consent).
3. User A generates an invite code.
4. User B signs up, enters invite code.
5. User B connects Google Calendar.
6. Partnership is active. Both see the shared proposal feed.

### Journey 2: Manual Proposal Creation

1. User A taps "New Proposal" on the proposal feed.
2. User A fills in: title, location (optional), preferred date/time window, duration, notes (optional).
3. On submit, the app calls the `generate-slots` Edge Function:
   - Reads both partners' Google Calendars for the requested date/time window.
   - Returns a set of **candidate time slots** that are conflict-free for both partners.
4. User A picks a preferred slot (or keeps their original time despite conflicts).
5. Proposal is created in `proposals` table with status `proposed` and `pending_actor_id` set to User B.
6. A `proposal_action` row is recorded: `{action: 'proposed', actor: User A}`.
7. User B opens the app and sees the new proposal on the feed.

### Journey 3: Negotiation

1. User B opens the proposal. They see the current version details and full action history.
2. Conflict status for both calendars is displayed on the proposal.
3. User B has three choices:
   - **Accept** → status moves to `accepted`, action recorded `{action: 'accepted', actor: User B}`.
   - **Counter-propose** → User B edits fields (time, location, etc.). A new `proposal_version` row is created. Status moves to `counter_proposed`, `pending_actor_id` flips to User A. Action recorded `{action: 'countered', actor: User B}`.
   - **Decline** → status moves to `declined`. Action recorded `{action: 'declined', actor: User B}`. Terminal.
4. User A sees the counter, can accept, counter again, or decline. Each action is recorded and `pending_actor_id` flips accordingly.
5. Either partner can **withdraw** at any point from any pre-finalized state → status `withdrawn`. Action recorded.

### Journey 4: Finalization

1. When a partner accepts, the client calls the `finalize-proposal` Edge Function.
2. Edge Function writes the event to both Google Calendars.
3. Status moves to `finalized`. Google Calendar event IDs are stored. Action recorded `{action: 'finalized', actor: system}`.
4. Both partners see the event in their "Upcoming" list with a "synced" badge.

### Journey 5: Cancellation

1. Either partner can cancel a finalized event → Edge Function deletes from both GCals → status `cancelled`. Action recorded.

### Journey 6: Voice Proposal (Post-MVP Enhancement)

1. User A taps the voice button (FAB at bottom-center).
2. User A speaks: "Dinner at Sushi Roku Friday around 7."
3. Audio → Edge Function → OpenAI Whisper (STT) → OpenAI GPT (structured extraction).
4. Parsed fields pre-fill the manual proposal form. User reviews, edits, and submits.
5. From here, the flow is identical to Journey 2 (candidate slots, submit).

---

## 3. MVP Scope

### In Scope (MVP)

- Email/password sign-up via Supabase Auth
- Google Calendar OAuth2 connection
- Invite-code-based partner linking
- Manual proposal creation (text form)
- Candidate time slot generation (conflict-free slots from both calendars)
- Proposal feed (list of all proposals, sorted by recency)
- Conflict detection against both calendars
- Accept / counter-propose / decline / withdraw negotiation
- Pending actor tracking (who owes the next action)
- Full proposal action history (audit trail)
- Write finalized event to both Google Calendars
- Cancel finalized event (removes from both GCals)
- Upcoming events view

### Out of Scope (MVP — Planned for Post-MVP)

- **Voice input** — input accelerator, not core. Added after manual flows are solid.
- **Push notifications** — not launch-critical. Pull-to-refresh and on-open fetch are sufficient for two users.
- **Supabase Realtime subscriptions** — optional UX enhancement, not a correctness dependency.

### Out of Scope (No Current Plans)

- Recurring events
- Multi-day events
- In-app chat or messaging
- Photo/attachment sharing
- Multiple partnerships
- Non-Google calendar providers
- Offline-first / local-first sync
- Dark mode
- Web client

---

## 4. Recommended System Architecture

```
┌─────────────────────────────────────────────────┐
│                  Mobile App                      │
│          Expo + React Native + TypeScript        │
│                                                  │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Screens   │  │ Hooks    │  │ State (React │  │
│  │           │  │          │  │ Context)     │  │
│  └───────────┘  └──────────┘  └──────────────┘  │
│         │              │              │           │
│         └──────────────┼──────────────┘           │
│                        │                          │
│              ┌─────────▼─────────┐                │
│              │  Supabase Client  │                │
│              │  (JS SDK)         │                │
│              └─────────┬─────────┘                │
└────────────────────────┼──────────────────────────┘
                         │ HTTPS (fetch/mutate)
                         ▼
┌─────────────────────────────────────────────────┐
│                 Supabase                         │
│                                                  │
│  ┌──────────┐  ┌───────────┐                     │
│  │ Auth     │  │ Postgres  │                     │
│  │          │  │ + RLS     │                     │
│  └──────────┘  └───────────┘                     │
│                                                  │
│  ┌──────────────────────────────────────┐        │
│  │        Edge Functions (Deno)         │        │
│  │                                      │        │
│  │  ┌────────────────┐ ┌─────────────┐  │        │
│  │  │ generate-slots │ │ finalize-   │  │        │
│  │  │                │ │ proposal    │  │        │
│  │  └───────┬────────┘ └──────┬──────┘  │        │
│  │          │                 │         │        │
│  └──────────┼─────────────────┼─────────┘        │
└─────────────┼─────────────────┼──────────────────┘
              │                 │
              ▼                 ▼
       ┌──────────────┐
       │ Google       │
       │ Calendar API │
       └──────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State management | React Context + `useReducer` | Two-user app with small state. No Redux/Zustand needed. |
| Data flow | Deterministic fetch/mutate | Every screen fetches its data on mount/focus. Mutations return updated data. No dependency on subscriptions for correctness. |
| Server logic | Supabase Edge Functions | Keeps secrets server-side (Google tokens). No separate backend to deploy. |
| Realtime updates | **Not in MVP.** Optional enhancement later. | App correctness must not depend on Realtime. Fetch-on-focus and pull-to-refresh are sufficient for two users. Can be layered on as a polish pass. |
| Push notifications | **Not in MVP.** Planned post-MVP. | Two users checking the app is sufficient for launch. Push is a retention optimization, not a correctness requirement. |
| Auth | Supabase Auth (email/password) | Simplest. Google OAuth for calendar is separate from auth. |
| Navigation | Expo Router (file-based) | Standard Expo choice, simple and well-supported. |
| Google Calendar tokens | Stored in Supabase (encrypted column) | Edge Functions use them server-side. Client never touches raw tokens. |

### Data Flow Pattern

All hooks follow a consistent fetch/mutate pattern:

```
// Fetch: screen loads or gains focus
const { data, isLoading, refetch } = useProposals(partnershipId)

// Mutate: user takes action, returns fresh data
const { mutate: acceptProposal } = useAcceptProposal({
  onSuccess: (updatedProposal) => {
    // Update local state with server response
    // No reliance on Realtime to propagate the change
  }
})

// Refresh: pull-to-refresh or focus listener
useFocusEffect(() => { refetch() })
```

This pattern means:
- The app works identically with or without Realtime.
- Realtime can be added later as a "bonus" that makes updates feel instant.
- No race conditions between optimistic updates and subscription events.

---

## 5. Database / Entity Model

### Tables

```
profiles
────────────────────────────────────
id              uuid    PK (= auth.users.id)
email           text    NOT NULL
display_name    text    NOT NULL
avatar_url      text    NULLABLE
created_at      timestamptz
updated_at      timestamptz

partnerships
────────────────────────────────────
id              uuid    PK
partner_a_id    uuid    FK → profiles.id
partner_b_id    uuid    FK → profiles.id  NULLABLE (null until partner B joins)
invite_code     text    UNIQUE NOT NULL
status          text    CHECK (pending, active, dissolved)
created_at      timestamptz
updated_at      timestamptz
UNIQUE(partner_a_id)  -- one partnership per person

google_calendar_connections
────────────────────────────────────
id              uuid    PK
profile_id      uuid    FK → profiles.id  UNIQUE
access_token    text    NOT NULL (encrypted)
refresh_token   text    NOT NULL (encrypted)
token_expires_at timestamptz
calendar_id     text    NOT NULL DEFAULT 'primary'
created_at      timestamptz
updated_at      timestamptz

proposals
────────────────────────────────────
id              uuid    PK
partnership_id  uuid    FK → partnerships.id
created_by      uuid    FK → profiles.id
status          text    CHECK (proposed, counter_proposed, accepted,
                               finalized, withdrawn, declined, cancelled)
pending_actor_id uuid   FK → profiles.id  NULLABLE
                        -- Who owes the next action.
                        -- NULL when status is terminal (finalized, withdrawn,
                        -- declined, cancelled) or when no specific actor is
                        -- required (accepted → system finalizes).
current_version int     NOT NULL DEFAULT 1
created_at      timestamptz
updated_at      timestamptz

proposal_versions
────────────────────────────────────
id              uuid    PK
proposal_id     uuid    FK → proposals.id
version_number  int     NOT NULL
created_by      uuid    FK → profiles.id
title           text    NOT NULL
location        text    NULLABLE
proposed_start  timestamptz NOT NULL
proposed_end    timestamptz NOT NULL
notes           text    NULLABLE
created_at      timestamptz
UNIQUE(proposal_id, version_number)

-- Versions are immutable snapshots of the event details.
-- A new version is created only when event details change
-- (initial proposal, counter-proposals).
-- Accepting, declining, or withdrawing do NOT create versions.

proposal_actions
────────────────────────────────────
id              uuid    PK
proposal_id     uuid    FK → proposals.id
actor_id        uuid    FK → profiles.id  NULLABLE (NULL for system actions)
action          text    CHECK (proposed, countered, accepted, declined,
                               withdrawn, finalized, cancelled)
version_number  int     NULLABLE
                        -- References the proposal_version this action relates to.
                        -- Set for 'proposed' and 'countered' (they create versions).
                        -- NULL for 'accepted', 'declined', 'withdrawn', etc.
note            text    NULLABLE  -- optional reason for decline/withdraw
metadata        jsonb   NULLABLE  -- extensible (e.g., conflict snapshot at action time)
created_at      timestamptz NOT NULL DEFAULT now()

-- Actions are the immutable audit trail. Every state transition
-- produces exactly one action row. Actions are append-only.
-- This table answers: "What happened, when, and by whom?"

calendar_events
────────────────────────────────────
id              uuid    PK
proposal_id     uuid    FK → proposals.id  UNIQUE
gcal_event_id_a text    NOT NULL  -- Google Calendar event ID for partner A
gcal_event_id_b text    NOT NULL  -- Google Calendar event ID for partner B
synced_at       timestamptz
```

### Versions vs. Actions — Why They Are Separate

| Concern | Table | Example |
|---------|-------|---------|
| "What are the current event details?" | `proposal_versions` | Version 3: "Dinner at Sushi Roku, Fri 7pm–9pm" |
| "What happened in this negotiation?" | `proposal_actions` | proposed → countered → countered → accepted → finalized |
| "Who changed the time?" | Join both | Action `countered` at version 2, created_by = User B |
| "Who owes the next move?" | `proposals.pending_actor_id` | User A (after User B countered) |

**Versions** are created only when event details change (propose, counter).
**Actions** are created for every state transition, including ones that don't change details (accept, decline, withdraw, finalize, cancel).

This separation means:
- The action history is a clean, append-only log.
- Version history shows only meaningful content changes.
- You never have to scan version rows to reconstruct what happened — the action log tells you directly.

### Row-Level Security (RLS) Strategy

Every table is locked down. Access is granted only when:
- `profiles`: user can read/write their own row.
- `partnerships`: user can read if they are `partner_a_id` or `partner_b_id`.
- `google_calendar_connections`: user can read/write their own row only.
- `proposals`, `proposal_versions`, `proposal_actions`: user can read/write if they belong to the partnership.
- `calendar_events`: user can read if they belong to the partnership.

Edge Functions use the `service_role` key for operations that need cross-user access (e.g., reading both partners' tokens during calendar sync).

---

## 6. Negotiation State Machine

```
                         ┌─────────────────────────┐
                         │       proposed           │
                         │  pending_actor: partner  │
                         └───┬──────┬──────────┬───┘
                             │      │          │
                      accept │      │ counter  │ decline
                             │      │          │
                             ▼      ▼          ▼
                    ┌──────────┐  ┌────────────────────────┐  ┌──────────┐
                    │ accepted │  │   counter_proposed      │  │ declined │
                    │ pending: │  │   pending_actor: other  │◄─┐ (terminal)
                    │  NULL    │  └───┬──────┬─────────┬───┘  │ └──────────┘
                    └────┬─────┘     │      │         │       │
                         │    accept │      │ counter │       │
                  finalize│          │      └─────────┘       │
                         │          │                  decline│
                         ▼          ▼                         ▼
                    ┌───────────┐  ┌──────────┐          ┌──────────┐
                    │ finalized │  │ accepted │          │ declined │
                    │ (terminal)│  │ pending: │          │ (terminal)│
                    └─────┬─────┘  │  NULL    │          └──────────┘
                          │        └────┬─────┘
                   cancel │      finalize│
                          ▼             ▼
                    ┌───────────┐  ┌───────────┐
                    │ cancelled │  │ finalized │
                    │ (terminal)│  │ (terminal)│
                    └───────────┘  └─────┬─────┘
                                         │
                                  cancel │
                                         ▼
                                   ┌───────────┐
                                   │ cancelled │
                                   │ (terminal)│
                                   └───────────┘

        (withdraw from any pre-finalized state by either partner)
        {proposed, counter_proposed, accepted} ──► withdrawn (terminal)
```

### State Definitions

| State | `pending_actor_id` | Meaning |
|-------|--------------------|---------|
| `proposed` | Partner (not creator) | Initial proposal created. Waiting for partner response. |
| `counter_proposed` | The other partner (not the one who just countered) | One partner suggested changes. The other partner owes a response. |
| `accepted` | `NULL` | Both partners agree on the current version. System will finalize. |
| `finalized` | `NULL` | Event written to both Google Calendars. Terminal unless cancelled. |
| `declined` | `NULL` | Partner explicitly rejected the proposal. Terminal. |
| `withdrawn` | `NULL` | Either partner abandoned the proposal before finalization. Terminal. |
| `cancelled` | `NULL` | Finalized event removed from both calendars. Terminal. |

### Transition Rules

| From | To | Who Can Trigger | `pending_actor_id` After | Side Effects |
|------|----|-----------------|--------------------------|-------------|
| `proposed` | `accepted` | Pending actor only | `NULL` | Action: `accepted` |
| `proposed` | `counter_proposed` | Pending actor only | Flips to other partner | Action: `countered` + new `proposal_version` |
| `proposed` | `declined` | Pending actor only | `NULL` | Action: `declined` |
| `proposed` | `withdrawn` | Either partner | `NULL` | Action: `withdrawn` |
| `counter_proposed` | `accepted` | Pending actor only | `NULL` | Action: `accepted` |
| `counter_proposed` | `counter_proposed` | Pending actor only | Flips to other partner | Action: `countered` + new `proposal_version` |
| `counter_proposed` | `declined` | Pending actor only | `NULL` | Action: `declined` |
| `counter_proposed` | `withdrawn` | Either partner | `NULL` | Action: `withdrawn` |
| `accepted` | `finalized` | System (triggered by accept) | `NULL` | Action: `finalized` + write to both GCals |
| `finalized` | `cancelled` | Either partner | `NULL` | Action: `cancelled` + delete from both GCals |

### Pending Actor Rules

1. **On `proposed`:** The partner who did NOT create the proposal is the pending actor.
2. **On `counter_proposed`:** The partner who did NOT submit the latest counter is the pending actor.
3. **On terminal states:** `pending_actor_id` is always `NULL`.
4. **On `accepted`:** `pending_actor_id` is `NULL` — the system auto-finalizes.
5. **Enforcement:** Only the pending actor can accept, counter, or decline. Either partner can withdraw. This is enforced server-side via RLS or Edge Function validation.

> **Design note:** `accepted → finalized` is triggered automatically. When a partner accepts, the client calls the `finalize-proposal` Edge Function, which writes to both calendars and updates status atomically. If the calendar write fails, status stays `accepted` and the user sees an error with a retry option.

---

## 7. Google Calendar Integration Design

### OAuth2 Flow

1. Client initiates Google OAuth using `expo-auth-session` (AuthSession.useAuthRequest).
2. Scopes: `https://www.googleapis.com/auth/calendar.events` (read/write events).
3. On callback, client sends the authorization code to Edge Function `google-auth-callback`.
4. Edge Function exchanges code for access + refresh tokens via Google token endpoint.
5. Tokens stored in `google_calendar_connections` (encrypted at rest via `pgsodium` or application-level encryption).
6. Client never sees or stores raw tokens.

### Token Refresh

- Edge Functions check `token_expires_at` before every Google API call.
- If expired, use refresh token to get new access token, update the row.
- If refresh fails (revoked), mark connection as broken, notify user to re-auth.

### Candidate Slot Generation

When creating or countering a proposal, the client calls the `generate-slots` Edge Function:

1. Client sends: desired date range, preferred time-of-day window, and duration.
2. Edge Function queries Google Calendar's `freebusy` API for both partners across the date range.
3. Edge Function computes conflict-free time slots that fit both calendars.
4. Returns an ordered list of candidate slots to the client.
5. User picks a slot or ignores suggestions and picks their own time.

This is a **read-only, stateless query** — it doesn't write anything to the database. The selected time is submitted as part of the proposal version.

### Conflict Detection

- When a proposal detail screen is opened, the client calls `check-conflicts` Edge Function with the current version's proposed time.
- It queries Google Calendar's `freebusy` API for both partners at the proposed time window.
- Results are returned to the client for display (not stored in the database — they are ephemeral and may change).
- The UI shows a conflict badge if either partner has a conflict at the proposed time.

### Event Write (Finalization)

- Edge Function `finalize-proposal` reads the accepted version's details.
- Creates a Google Calendar event in each partner's primary calendar.
- Stores the resulting `gcal_event_id_a` and `gcal_event_id_b` in `calendar_events`.
- If either write fails, the whole operation fails (no half-synced state). The function retries once, then returns error.

### Event Delete (Cancellation)

- Edge Function `cancel-event` deletes the event from both calendars using stored event IDs.
- If one delete fails, it logs the failure and proceeds (best-effort; the user can manually remove from GCal).

---

## 8. Voice Button Interaction Design (Post-MVP)

> **Note:** Voice input is not in the MVP. It is designed here for completeness and will be implemented after the manual proposal + negotiation flow is working correctly. Voice is an input accelerator — it pre-fills the same manual proposal form.

### UX Flow

1. **Idle state:** Floating action button (FAB) at bottom-center of the proposal feed. Microphone icon. Always visible.
2. **Recording state:** User presses and holds (or taps to start, taps to stop — support both).
   - FAB grows/pulses with visual feedback.
   - Waveform animation on screen.
   - Timer shows recording duration.
   - Max recording: 30 seconds.
3. **Processing state:** FAB shows spinner. "Listening..." label.
4. **Review state:** The manual proposal form opens with parsed fields pre-filled.
   - Shows extracted: title, date/time, location, duration, notes.
   - Each field is editable (it's the same form as manual entry).
   - From here, the flow is identical to manual proposal creation (candidate slots, submit).
5. **Error state:** If parsing fails, show friendly error with option to retry or type manually.

### Technical Flow

```
[User taps FAB]
      │
      ▼
[expo-av starts recording (m4a/wav)]
      │
      ▼
[User releases / taps stop]
      │
      ▼
[Upload audio to Edge Function: voice-parse]
      │
      ▼
[Edge Function → OpenAI Whisper API (transcription)]
      │
      ▼
[Edge Function → OpenAI Chat API (structured extraction)]
  Prompt: "Extract event details from this text.
           Return JSON: {title, location, date, start_time, end_time, notes}"
      │
      ▼
[Return structured JSON to client]
      │
      ▼
[Client pre-fills manual proposal form → standard flow continues]
```

### Edge Cases

- **Ambiguous time:** "Friday evening" → extract as Friday 18:00, duration 2h default. User can adjust in form.
- **Missing fields:** Only `title` is required from voice. Date/time left blank in form — user must fill before submitting.
- **Unintelligible audio:** Return transcript + error. Let user type manually.

---

## 9. Screen Map

```
(Auth)
├── Welcome                     -- logo, "Sign Up" / "Sign In" buttons
├── Sign Up                     -- email, password, display name
├── Sign In                     -- email, password
│
(Onboarding)
├── Connect Calendar            -- Google OAuth prompt
├── Partnership Setup
│   ├── Create Partnership      -- generates invite code, shows it
│   └── Join Partnership        -- enter invite code
│
(Main App — Tab Navigator)
├── Proposals (Home Tab)
│   ├── Proposal Feed           -- list of all proposals, sorted by status/date
│   │                              Shows pending_actor badge ("Your turn" / "Waiting")
│   ├── Proposal Detail         -- current version + action history timeline
│   │   ├── Accept action       -- (only shown to pending actor)
│   │   ├── Counter-propose     -- opens form with current version pre-filled
│   │   ├── Decline action      -- (only shown to pending actor)
│   │   └── Withdraw action     -- (shown to either partner)
│   └── New Proposal            -- manual form: title, location, date/time, duration, notes
│       └── Slot Picker         -- candidate time slots from both calendars
│
├── Upcoming (Tab)
│   └── Upcoming Events         -- finalized events, sorted by date
│       └── Event Detail        -- view details, cancel action
│
├── Profile (Tab)
│   ├── Profile View            -- name, email, calendar status
│   ├── Calendar Reconnect      -- re-auth Google if connection broken
│   └── Partnership Info        -- partner name, dissolve option
│
(Overlays / Modals — MVP)
├── Slot Picker Sheet           -- bottom sheet showing candidate time slots
└── Conflict Warning Modal      -- shown when selected time has conflicts

(Overlays / Modals — Post-MVP)
├── Voice Recording Sheet       -- bottom sheet during voice capture
└── Voice FAB                   -- floating action button on proposal feed
```

**Total unique screens (MVP): ~12** (including modals/sheets)

---

## 10. Folder / Module Structure

```
honeycal/
├── app/                            # Expo Router file-based routing
│   ├── _layout.tsx                 # Root layout (providers, auth gate)
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── welcome.tsx
│   │   ├── sign-up.tsx
│   │   └── sign-in.tsx
│   ├── (onboarding)/
│   │   ├── _layout.tsx
│   │   ├── connect-calendar.tsx
│   │   └── partnership-setup.tsx
│   └── (main)/
│       ├── _layout.tsx             # Tab navigator
│       ├── (proposals)/
│       │   ├── index.tsx           # Proposal feed
│       │   ├── [id].tsx            # Proposal detail + action history
│       │   └── new.tsx             # Manual new proposal + slot picker
│       ├── (upcoming)/
│       │   ├── index.tsx           # Upcoming events
│       │   └── [id].tsx            # Event detail
│       └── (profile)/
│           └── index.tsx           # Profile screen
│
├── components/                     # Shared UI components
│   ├── ProposalCard.tsx            # Card in feed, shows pending actor badge
│   ├── ActionTimeline.tsx          # Chronological action history on detail screen
│   ├── SlotPicker.tsx              # Candidate time slot selection
│   ├── ConflictBadge.tsx
│   ├── EventCard.tsx
│   └── ui/                         # Generic primitives
│       ├── Button.tsx
│       ├── TextInput.tsx
│       ├── BottomSheet.tsx
│       └── StatusBadge.tsx
│
├── hooks/                          # Custom React hooks
│   ├── useAuth.ts
│   ├── usePartnership.ts
│   ├── useProposals.ts            # Fetch proposal list, refetch on focus
│   ├── useProposalDetail.ts       # Fetch single proposal + versions + actions
│   ├── useProposalMutations.ts    # accept, counter, decline, withdraw
│   ├── useGenerateSlots.ts        # Call generate-slots Edge Function
│   ├── useUpcomingEvents.ts
│   └── useCalendarConnection.ts
│
├── providers/                      # React Context providers
│   ├── AuthProvider.tsx
│   └── PartnershipProvider.tsx
│
├── lib/                            # Utilities and client config
│   ├── supabase.ts                 # Supabase client init
│   ├── constants.ts                # App constants
│   └── types.ts                    # Shared TypeScript types
│
├── supabase/
│   ├── migrations/                 # SQL migrations
│   │   └── 001_initial_schema.sql
│   └── functions/                  # Edge Functions
│       ├── generate-slots/         # Query both calendars, return candidate slots
│       │   └── index.ts
│       ├── check-conflicts/        # Check conflicts for a specific time
│       │   └── index.ts
│       ├── finalize-proposal/      # Write event to both GCals
│       │   └── index.ts
│       ├── cancel-event/           # Delete event from both GCals
│       │   └── index.ts
│       ├── google-auth-callback/   # Exchange auth code for tokens
│       │   └── index.ts
│       └── google-refresh-token/   # Refresh expired access tokens
│           └── index.ts
│
├── assets/                         # Images, fonts
├── app.json                        # Expo config
├── tsconfig.json
├── package.json
└── .env                            # SUPABASE_URL, SUPABASE_ANON_KEY (gitignored)
```

### Module Boundaries

- **`app/`** — Screens only. No business logic. Screens compose hooks and components.
- **`hooks/`** — All data fetching and mutations. Every hook follows fetch-on-focus + explicit mutate pattern. No realtime subscriptions in MVP.
- **`components/`** — Pure UI. Receive data via props. No direct Supabase calls.
- **`providers/`** — Auth state, partnership state. Thin wrappers. No notification provider in MVP.
- **`lib/`** — Configuration, types, pure utilities. No React.
- **`supabase/functions/`** — Server-side logic. Handles secrets, external APIs, cross-user operations. Each function has a single responsibility.

---

## 11. Implementation Phases

### Phase 1: Foundation (Auth + Partnership)

- Initialize Expo project with Expo Router
- Set up Supabase client
- Implement Supabase Auth (sign up, sign in, session management)
- Create `profiles` and `partnerships` tables with RLS
- Build auth screens (Welcome, Sign Up, Sign In)
- Build partnership setup (create invite code, join via code)
- AuthProvider and PartnershipProvider
- Profile screen (basic)

**Exit criteria:** Two users can sign up and link as partners.

### Phase 2: Google Calendar Connection

- Implement Google OAuth flow via `expo-auth-session`
- Build `google-auth-callback` Edge Function (token exchange)
- Build `google-refresh-token` Edge Function
- Create `google_calendar_connections` table with RLS
- Build Connect Calendar onboarding screen
- Build calendar reconnect in Profile

**Exit criteria:** Both partners have Google Calendar connected, tokens stored securely server-side.

### Phase 3: Proposals + Negotiation

- Create `proposals`, `proposal_versions`, and `proposal_actions` tables with RLS
- Build `generate-slots` Edge Function (query both calendars, return candidate slots)
- Build `check-conflicts` Edge Function
- Build new proposal screen (manual form + slot picker)
- Build proposal feed screen (with pending actor badges, fetch-on-focus)
- Build proposal detail screen (current version + action timeline + negotiation actions)
- Implement full state machine: propose, counter, accept, decline, withdraw
- Implement `pending_actor_id` enforcement (only pending actor can accept/counter/decline)
- All mutations return updated data; no realtime dependency

**Exit criteria:** Partners can create proposals with candidate slot suggestions, negotiate through counter-proposals, accept, decline, or withdraw. Full action history is recorded and visible.

### Phase 4: Finalization + Calendar Sync

- Build `finalize-proposal` Edge Function (write event to both GCals)
- Build `cancel-event` Edge Function (delete event from both GCals)
- Create `calendar_events` table with RLS
- Build Upcoming Events screen
- Build Event Detail screen with cancel action
- Auto-finalization triggered on accept (via `finalize-proposal` Edge Function)

**Exit criteria:** Accepted proposals sync to both Google Calendars. Cancellation removes from both. This is the MVP milestone.

### Phase 5: Polish + Hardening

- Loading states, error states, empty states across all screens
- Pull-to-refresh on proposal feed and upcoming events
- Edge case handling (token expiration, network errors, partial GCal failures)
- App icon, splash screen
- RLS policy audit across all tables
- Test with two real devices / TestFlight

**Exit criteria:** MVP ready for TestFlight.

---

### Post-MVP Phases (Not Part of Initial Build)

### Phase 6: Voice Input

- Integrate `expo-av` for audio recording
- Build VoiceButton FAB component
- Build VoiceRecordingSheet (bottom sheet)
- Build `voice-parse` Edge Function (OpenAI Whisper + GPT structured extraction)
- Voice output pre-fills the existing manual proposal form
- Connect to standard proposal creation flow (slot picker, submit)

**Exit criteria:** User can speak a proposal, review parsed fields in the form, and submit.

### Phase 7: Realtime Enhancement (Optional)

- Add Supabase Realtime subscriptions to proposal feed and detail hooks
- Layer on top of existing fetch-on-focus pattern (additive, not replacing)
- If subscription is active, partner sees updates instantly; if not, fetch-on-focus still works

**Exit criteria:** Partner sees live updates without pull-to-refresh. App still works correctly without Realtime.

### Phase 8: Push Notifications

- Set up Expo push notifications
- Add `expo_push_token` column to `profiles`
- Send notifications on: new proposal, counter-proposal, acceptance, finalization, cancellation
- Notification triggers from Edge Function side-effects

**Exit criteria:** Partners receive push notifications for proposal activity.

---

## 12. Risks and Architecture Guardrails

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google OAuth token revocation | Medium | High — breaks calendar sync | Detect revoked tokens, prompt re-auth. Degrade gracefully (proposals still work without calendar). |
| Google API rate limits | Low | Medium | Batch freebusy queries. Cache conflict results client-side per session. |
| Scope creep toward chat/tasks/AI | High | High — architectural drift | This document. Code review discipline. No message table. No task table. |
| Token storage security | Medium | High | Encrypt tokens at rest. Never send tokens to client. Edge Functions only. |
| Half-synced calendar state | Low | Medium | Atomic finalization: if either GCal write fails, status stays `accepted`, user retries. |
| Pending actor logic bugs | Medium | Medium — wrong person sees actions | Enforce `pending_actor_id` server-side in Edge Functions and/or RLS. Client-side checks are cosmetic only. |
| Stale data without Realtime | Low | Low — two-user app | Fetch-on-focus and pull-to-refresh are sufficient. Users can also manually refresh. |

### Architecture Guardrails

1. **No direct Google API calls from client.** All Google API interaction goes through Edge Functions.
2. **No business logic in screens.** Screens render components with data from hooks. That's it.
3. **No new database tables without updating this document first.** Schema changes require design review.
4. **No new Supabase Edge Functions without a clear single responsibility.** One function = one job.
5. **No local storage for proposal/event data.** Supabase is the only source of truth. `AsyncStorage` is only for non-critical UX preferences (e.g., "has seen onboarding").
6. **No multi-partnership support.** If the schema or code starts accommodating more than two users or more than one partnership, it's a red flag.
7. **No Realtime or push as correctness dependencies.** Every flow must work through explicit fetch and mutate. Realtime and push are layered enhancements only.
8. **No voice/AI features until manual flows are complete and tested.** Voice is an input accelerator. It pre-fills the same form manual entry uses.
9. **RLS on every table, no exceptions.** Test RLS policies before shipping each phase.
10. **TypeScript strict mode.** No `any` types. No `// @ts-ignore`.
11. **Edge Functions must validate inputs.** Never trust client-sent data. Verify auth, verify partnership membership, verify state machine transitions server-side.
12. **Pending actor enforcement is server-side.** The client hides/shows buttons for UX, but the server rejects invalid transitions. A user cannot accept their own proposal or act out of turn.
13. **Actions are append-only.** The `proposal_actions` table is an immutable audit log. No updates, no deletes. Every state transition produces exactly one action row.
