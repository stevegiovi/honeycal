# HoneyCal — Design Document

> Private two-person event coordination app for partners.
> One job: propose, negotiate, finalize events into both Google Calendars.

---

## 1. Product Spec

### What HoneyCal Is

A mobile app for exactly two linked partners. It lets either partner propose an event (primarily via voice), checks both Google Calendars for conflicts, supports a structured negotiation flow to agree on time/details, and writes the finalized event to both calendars.

### What HoneyCal Is Not

- Not a chat app
- Not a task manager
- Not a family/group organizer
- Not a general-purpose calendar app
- Not a social platform

### Core Principles

1. **Two users, one partnership.** The data model never accommodates more.
2. **Database is truth.** Local device state is a cache, never canonical.
3. **Voice-first entry.** The primary way to create a proposal is speaking.
4. **Low friction.** Every screen earns its existence. No settings mazes.
5. **Google Calendar is the external system of record.** HoneyCal reads/writes GCal but never replaces it.
6. **Narrow scope, clean extension points.** Ship the small thing correctly.

---

## 2. Core User Journeys

### Journey 1: Partner Onboarding

1. User A signs up (Supabase Auth via email/password or Google OAuth).
2. User A connects Google Calendar (OAuth2 consent).
3. User A generates an invite code.
4. User B signs up, enters invite code.
5. User B connects Google Calendar.
6. Partnership is active. Both see the shared proposal feed.

### Journey 2: Voice Proposal

1. User A taps the voice button (always visible, bottom-center).
2. User A speaks: "Dinner at Sushi Roku Friday around 7."
3. Audio is sent to Supabase Edge Function → OpenAI Whisper (STT) → OpenAI GPT (structured extraction).
4. Extracted fields: `title`, `location`, `proposed_date`, `proposed_time`, `duration` (defaulted), `notes`.
5. User A reviews the parsed proposal card, can edit fields, then submits.
6. Proposal is created in `proposals` table with state `proposed`.
7. User B receives a push notification and sees the proposal.

### Journey 3: Negotiation

1. User B opens the proposal.
2. App automatically checks both calendars for conflicts at the proposed time.
3. If no conflicts: User B can **accept** → state moves to `accepted`.
4. If conflicts or preference: User B can **suggest changes** (time, date, location, or any field) → state moves to `counter_proposed`, a new `proposal_version` row is created.
5. User A sees the counter, can accept or counter again.
6. Either partner can **withdraw** at any point → state moves to `withdrawn`.
7. Once either partner accepts (and no conflicts exist), state → `accepted`.

### Journey 4: Finalization

1. On `accepted`, the app writes the event to both Google Calendars via Edge Function.
2. State moves to `finalized`. The Google Calendar event IDs are stored.
3. Both partners see the event in their "Upcoming" list with a "synced" badge.

### Journey 5: Cancellation / Edit After Finalization

1. Either partner can cancel a finalized event → deletes from both GCals → state `cancelled`.
2. Either partner can propose an edit to a finalized event → creates a new negotiation round on the same proposal.

---

## 3. MVP Scope

### In Scope (MVP)

- Email/password sign-up via Supabase Auth
- Google Calendar OAuth2 connection
- Invite-code-based partner linking
- Voice-to-proposal via OpenAI (Whisper + structured extraction)
- Manual text proposal creation (fallback)
- Proposal feed (list of all proposals, sorted by recency)
- Conflict detection against both calendars
- Accept / counter-propose / withdraw negotiation
- Write finalized event to both Google Calendars
- Cancel finalized event (removes from both GCals)
- Push notifications (Expo push)
- Upcoming events view

### Out of Scope (MVP)

- Recurring events
- Multi-day events
- Calendar availability heatmap / suggestion engine
- In-app chat or messaging
- Photo/attachment sharing
- Multiple partnerships
- Non-Google calendar providers
- Offline-first / local-first sync
- Dark mode (can be added trivially later)
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
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────┐
│                 Supabase                         │
│                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Auth     │  │ Postgres  │  │ Realtime     │  │
│  │          │  │ + RLS     │  │ (subscriptions│  │
│  └──────────┘  └───────────┘  └──────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────┐        │
│  │        Edge Functions (Deno)         │        │
│  │                                      │        │
│  │  ┌─────────────┐ ┌───────────────┐   │        │
│  │  │ voice-parse │ │ calendar-sync │   │        │
│  │  └──────┬──────┘ └──────┬────────┘   │        │
│  │         │               │            │        │
│  └─────────┼───────────────┼────────────┘        │
└────────────┼───────────────┼─────────────────────┘
             │               │
             ▼               ▼
      ┌──────────┐   ┌──────────────┐
      │ OpenAI   │   │ Google       │
      │ API      │   │ Calendar API │
      └──────────┘   └──────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State management | React Context + `useReducer` | Two-user app with small state. No Redux/Zustand needed. |
| Server logic | Supabase Edge Functions | Keeps secrets server-side (Google tokens, OpenAI key). No separate backend to deploy. |
| Realtime updates | Supabase Realtime (Postgres changes) | Partner sees proposal updates live without polling. |
| Auth | Supabase Auth (email/password) | Simplest. Google OAuth for calendar is separate from auth. |
| Navigation | Expo Router (file-based) | Standard Expo choice, simple and well-supported. |
| Push notifications | Expo Notifications | Managed workflow compatible. |
| Audio recording | expo-av | Managed workflow compatible. |
| Google Calendar tokens | Stored in Supabase (encrypted column) | Edge Functions use them server-side. Client never touches raw tokens. |

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
expo_push_token text    NULLABLE
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
                               finalized, withdrawn, cancelled)
current_version int     NOT NULL DEFAULT 1
created_at      timestamptz
updated_at      timestamptz

proposal_versions
────────────────────────────────────
id              uuid    PK
proposal_id     uuid    FK → proposals.id
version_number  int     NOT NULL
proposed_by     uuid    FK → profiles.id
title           text    NOT NULL
location        text    NULLABLE
proposed_start  timestamptz NOT NULL
proposed_end    timestamptz NOT NULL
notes           text    NULLABLE
conflicts_a     jsonb   NULLABLE  -- cached conflict info for partner A
conflicts_b     jsonb   NULLABLE  -- cached conflict info for partner B
created_at      timestamptz
UNIQUE(proposal_id, version_number)

calendar_events
────────────────────────────────────
id              uuid    PK
proposal_id     uuid    FK → proposals.id  UNIQUE
gcal_event_id_a text    NOT NULL  -- Google Calendar event ID for partner A
gcal_event_id_b text    NOT NULL  -- Google Calendar event ID for partner B
synced_at       timestamptz
```

### Row-Level Security (RLS) Strategy

Every table is locked down. Access is granted only when:
- `profiles`: user can read/write their own row.
- `partnerships`: user can read if they are `partner_a_id` or `partner_b_id`.
- `google_calendar_connections`: user can read/write their own row only.
- `proposals` and `proposal_versions`: user can read/write if they belong to the partnership.
- `calendar_events`: user can read if they belong to the partnership.

Edge Functions use the `service_role` key for operations that need cross-user access (e.g., reading both partners' tokens during calendar sync).

---

## 6. Negotiation State Machine

```
                    ┌────────────────┐
                    │                │
          ┌────────►   proposed     │
          │         │                │
          │         └───┬───────┬───┘
          │             │       │
          │      accept │       │ counter
          │             │       │
          │             ▼       ▼
          │     ┌──────────┐  ┌──────────────────┐
          │     │ accepted │  │ counter_proposed  │◄──┐
          │     └────┬─────┘  └───┬──────────┬───┘   │
          │          │            │          │        │
          │  finalize│     accept │   counter│        │
          │          │            │          └────────┘
          │          ▼            ▼
          │     ┌───────────┐  ┌──────────┐
          │     │ finalized │  │ accepted │
          │     └─────┬─────┘  └────┬─────┘
          │           │             │
          │    cancel │      finalize│
          │           ▼             ▼
          │     ┌───────────┐  ┌───────────┐
          │     │ cancelled │  │ finalized │
          │     └───────────┘  └─────┬─────┘
          │                          │
          │                   cancel │
          │                          ▼
          │                    ┌───────────┐
          │                    │ cancelled │
          │                    └───────────┘
          │
          │  (withdraw from any pre-finalized state)
          │
          └──── Any of {proposed, counter_proposed, accepted}
                         │
                         ▼
                   ┌────────────┐
                   │ withdrawn  │
                   └────────────┘
```

### State Definitions

| State | Meaning |
|-------|---------|
| `proposed` | Initial proposal created. Waiting for partner response. |
| `counter_proposed` | Responding partner suggested changes. Waiting for original proposer (or either partner) to respond. |
| `accepted` | Both partners agree on the current version. Ready for finalization. |
| `finalized` | Event written to both Google Calendars. |
| `withdrawn` | Proposal abandoned before finalization. Terminal. |
| `cancelled` | Finalized event removed from both calendars. Terminal. |

### Transition Rules

| From | To | Who | Side Effects |
|------|----|-----|-------------|
| proposed | accepted | Partner (not creator) | None |
| proposed | counter_proposed | Partner (not creator) | New `proposal_version` row |
| proposed | withdrawn | Either | None |
| counter_proposed | accepted | Either | None |
| counter_proposed | counter_proposed | Either | New `proposal_version` row |
| counter_proposed | withdrawn | Either | None |
| accepted | finalized | System (auto) | Edge Function writes to both GCals |
| accepted | withdrawn | Either | None |
| finalized | cancelled | Either | Edge Function deletes from both GCals |

> **Design note:** `accepted → finalized` is triggered automatically by the system. When a partner accepts, the client calls the `finalize-proposal` Edge Function, which writes to both calendars and updates status atomically. If calendar write fails, status stays `accepted` and the user sees an error.

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

### Conflict Detection

- When a proposal version is created or viewed, Edge Function `check-conflicts` is called.
- It queries Google Calendar's `freebusy` API for both partners at the proposed time window.
- Results cached in `proposal_versions.conflicts_a` / `conflicts_b` (JSONB).
- Cache is invalidated when proposal time changes.

### Event Write (Finalization)

- Edge Function `finalize-proposal` reads the accepted version's details.
- Creates a Google Calendar event in each partner's primary calendar.
- Stores the resulting `gcal_event_id_a` and `gcal_event_id_b` in `calendar_events`.
- If either write fails, the whole operation fails (no half-synced state). The function retries once, then returns error.

### Event Delete (Cancellation)

- Edge Function `cancel-event` deletes the event from both calendars using stored event IDs.
- If one delete fails, it logs the failure and proceeds (best-effort; the user can manually remove from GCal).

---

## 8. Voice Button Interaction Design

### UX Flow

1. **Idle state:** Floating action button (FAB) at bottom-center of the proposal feed. Microphone icon. Always visible.
2. **Recording state:** User presses and holds (or taps to start, taps to stop — support both).
   - FAB grows/pulses with visual feedback.
   - Waveform animation on screen.
   - Timer shows recording duration.
   - Max recording: 30 seconds.
3. **Processing state:** FAB shows spinner. "Listening..." label.
4. **Review state:** Parsed proposal card appears as a bottom sheet.
   - Shows extracted: title, date/time, location, duration, notes.
   - Each field is editable inline.
   - "Submit Proposal" button at bottom.
   - "Discard" button (secondary).
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
[Client renders proposal review card]
```

### Edge Cases

- **Ambiguous time:** "Friday evening" → extract as Friday 18:00, duration 2h default. User can adjust.
- **Missing fields:** Only `title` is required from voice. Date/time default to "next available" — user must fill before submitting.
- **Unintelligible audio:** Return transcript + error. Let user edit manually.

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
│   ├── Proposal Detail         -- full detail + negotiation history
│   │   ├── Accept action
│   │   ├── Counter-propose (inline edit)
│   │   └── Withdraw action
│   └── New Proposal            -- manual text entry (fallback to voice)
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
(Overlays / Modals)
├── Voice Recording Sheet       -- bottom sheet during voice capture
├── Proposal Review Sheet       -- bottom sheet after voice parsing
└── Conflict Warning Modal      -- shown when conflicts detected
```

**Total unique screens: ~14** (including modals/sheets)

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
│       │   ├── [id].tsx            # Proposal detail
│       │   └── new.tsx             # Manual new proposal
│       ├── (upcoming)/
│       │   ├── index.tsx           # Upcoming events
│       │   └── [id].tsx            # Event detail
│       └── (profile)/
│           └── index.tsx           # Profile screen
│
├── components/                     # Shared UI components
│   ├── ProposalCard.tsx
│   ├── ProposalVersionHistory.tsx
│   ├── ConflictBadge.tsx
│   ├── VoiceButton.tsx
│   ├── VoiceRecordingSheet.tsx
│   ├── ProposalReviewSheet.tsx
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
│   ├── useProposals.ts
│   ├── useProposalDetail.ts
│   ├── useUpcomingEvents.ts
│   ├── useVoiceRecorder.ts
│   ├── useCalendarConnection.ts
│   └── useRealtimeSubscription.ts
│
├── providers/                      # React Context providers
│   ├── AuthProvider.tsx
│   ├── PartnershipProvider.tsx
│   └── NotificationProvider.tsx
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
│       ├── voice-parse/
│       │   └── index.ts
│       ├── check-conflicts/
│       │   └── index.ts
│       ├── finalize-proposal/
│       │   └── index.ts
│       ├── cancel-event/
│       │   └── index.ts
│       ├── google-auth-callback/
│       │   └── index.ts
│       └── google-refresh-token/
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
- **`hooks/`** — All data fetching, mutations, subscriptions. Hooks call Supabase client or Edge Functions.
- **`components/`** — Pure UI. Receive data via props. No direct Supabase calls.
- **`providers/`** — Auth state, partnership state, notification setup. Thin wrappers.
- **`lib/`** — Configuration, types, pure utilities. No React.
- **`supabase/functions/`** — Server-side logic. Handles secrets, external APIs, cross-user operations.

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

**Exit criteria:** Two users can sign up and link as partners.

### Phase 2: Google Calendar Connection

- Implement Google OAuth flow via `expo-auth-session`
- Build `google-auth-callback` Edge Function (token exchange)
- Build `google-refresh-token` Edge Function
- Create `google_calendar_connections` table
- Build Connect Calendar onboarding screen
- Build calendar reconnect in Profile

**Exit criteria:** Both partners have Google Calendar connected, tokens stored securely.

### Phase 3: Proposals + Negotiation (Text Only)

- Create `proposals` and `proposal_versions` tables with RLS
- Build proposal feed screen
- Build new proposal screen (manual text entry)
- Build proposal detail screen with negotiation actions
- Implement state machine transitions (accept, counter, withdraw)
- Set up Supabase Realtime subscriptions for live updates
- Build `check-conflicts` Edge Function

**Exit criteria:** Partners can create, negotiate, accept, and withdraw text proposals with conflict detection.

### Phase 4: Finalization + Calendar Sync

- Build `finalize-proposal` Edge Function (write to both GCals)
- Build `cancel-event` Edge Function (delete from both GCals)
- Create `calendar_events` table
- Build Upcoming Events screen
- Build Event Detail screen with cancel action
- Auto-finalization on accept

**Exit criteria:** Accepted proposals sync to both Google Calendars. Cancellation removes from both.

### Phase 5: Voice Input

- Integrate `expo-av` for audio recording
- Build VoiceButton FAB component
- Build VoiceRecordingSheet
- Build `voice-parse` Edge Function (Whisper + GPT extraction)
- Build ProposalReviewSheet
- Connect parsed output to proposal creation flow

**Exit criteria:** User can speak a proposal, review parsed fields, and submit.

### Phase 6: Push Notifications + Polish

- Set up Expo push notifications
- Store push tokens in `profiles`
- Send notifications on: new proposal, counter-proposal, acceptance, finalization
- Notification triggers from database webhooks or Edge Function side-effects
- UI polish, loading states, error handling, empty states
- App icon, splash screen

**Exit criteria:** Full MVP ready for TestFlight.

---

## 12. Risks and Architecture Guardrails

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google OAuth token revocation | Medium | High — breaks calendar sync | Detect revoked tokens, prompt re-auth. Degrade gracefully (proposals still work without calendar). |
| Google API rate limits | Low | Medium | Batch freebusy queries. Cache conflict results. |
| OpenAI API latency on voice parse | Medium | Medium — UX feels slow | Show clear processing state. Set 10s timeout. Allow manual fallback. |
| Supabase Realtime connection drops | Medium | Low — partner misses live update | Reconnect logic in hook. Pull-to-refresh as fallback. |
| Scope creep toward chat/tasks | High | High — architectural drift | This document. Code review discipline. No message table. No task table. |
| Token storage security | Medium | High | Encrypt tokens at rest. Never send tokens to client. Edge Functions only. |
| Half-synced calendar state | Low | Medium | Atomic finalization: if either GCal write fails, status stays `accepted`, user retries. |

### Architecture Guardrails

1. **No direct Google API calls from client.** All Google API interaction goes through Edge Functions.
2. **No business logic in screens.** Screens render components with data from hooks. That's it.
3. **No new database tables without updating this document first.** Schema changes require design review.
4. **No new Supabase Edge Functions without a clear single responsibility.** One function = one job.
5. **No local storage for proposal/event data.** Supabase is the only source of truth. `AsyncStorage` is only for non-critical UX preferences (e.g., "has seen onboarding").
6. **No multi-partnership support.** If the schema or code starts accommodating more than two users or more than one partnership, it's a red flag.
7. **No additional AI features beyond voice parsing.** No "AI suggestions," no "smart scheduling," no chatbot. Voice-to-structured-text is the only AI surface.
8. **RLS on every table, no exceptions.** Test RLS policies before shipping each phase.
9. **TypeScript strict mode.** No `any` types. No `// @ts-ignore`.
10. **Edge Functions must validate inputs.** Never trust client-sent data. Verify auth, verify partnership membership, verify state machine transitions server-side.
