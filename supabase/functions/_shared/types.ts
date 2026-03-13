// Database row types matching the schema exactly.

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type PartnershipStatus = "pending" | "active" | "dissolved";

export interface Partnership {
  id: string;
  partner_a_id: string;
  partner_b_id: string | null;
  invite_code: string;
  status: PartnershipStatus;
  created_at: string;
  updated_at: string;
}

export type ProposalStatus =
  | "proposed"
  | "counter_proposed"
  | "accepted"
  | "finalized"
  | "withdrawn"
  | "declined"
  | "cancelled";

export interface Proposal {
  id: string;
  partnership_id: string;
  created_by: string;
  status: ProposalStatus;
  pending_actor_id: string | null;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface ProposalVersion {
  id: string;
  proposal_id: string;
  version_number: number;
  created_by: string;
  title: string;
  location: string | null;
  proposed_start: string;
  proposed_end: string;
  notes: string | null;
  created_at: string;
}

export type ProposalActionType =
  | "proposed"
  | "countered"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "finalized"
  | "cancelled";

export interface ProposalAction {
  id: string;
  proposal_id: string;
  actor_id: string | null;
  action: ProposalActionType;
  version_number: number | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type CalendarSyncStatus = "synced" | "partial_failure" | "pending_retry";

export interface CalendarEvent {
  id: string;
  proposal_id: string;
  gcal_event_id_a: string | null;
  gcal_event_id_b: string | null;
  sync_status: CalendarSyncStatus;
  last_sync_error: string | null;
  synced_at: string;
}

export interface GoogleCalendarConnection {
  id: string;
  profile_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  calendar_id: string;
  scopes: string[];
  created_at: string;
  updated_at: string;
}

// Edge Function request types

export interface CounterVersionPayload {
  title: string;
  location?: string;
  proposed_start: string;
  proposed_end: string;
  notes?: string;
}

export interface ProposalActionRequest {
  proposal_id: string;
  action:
    | "accept"
    | "counter"
    | "decline"
    | "withdraw"
    | "retry_finalize";
  version?: CounterVersionPayload;
  note?: string;
}

export interface CancelEventRequest {
  proposal_id: string;
  retry?: boolean;
}

export interface GenerateSlotsRequest {
  date_range_start: string;
  date_range_end: string;
  time_window_start?: string;
  time_window_end?: string;
  duration_minutes: number;
}

export interface CheckConflictsRequest {
  proposed_start: string;
  proposed_end: string;
}

export interface TimeSlot {
  start: string;
  end: string;
}

export interface ConflictInfo {
  has_conflict: boolean;
  busy_times: TimeSlot[];
}
