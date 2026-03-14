// Client-side types mirroring the database schema.
// Keep in sync with supabase/functions/_shared/types.ts.

export type PartnershipStatus = "pending" | "active" | "dissolved";

export type ProposalStatus =
  | "proposed"
  | "counter_proposed"
  | "accepted"
  | "finalized"
  | "withdrawn"
  | "declined"
  | "cancelled";

export type ProposalActionType =
  | "proposed"
  | "countered"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "finalized"
  | "cancelled";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Partnership {
  id: string;
  partner_a_id: string;
  partner_b_id: string | null;
  invite_code: string;
  status: PartnershipStatus;
  created_at: string;
  updated_at: string;
}

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

export interface CalendarEvent {
  id: string;
  proposal_id: string;
  gcal_event_id_a: string | null;
  gcal_event_id_b: string | null;
  sync_status: "synced" | "partial_failure" | "pending_retry";
  last_sync_error: string | null;
  synced_at: string;
}

// Enriched types for UI consumption

export interface ProposalWithVersion extends Proposal {
  current_version_data: ProposalVersion | null;
}

export interface ProposalDetail extends Proposal {
  versions: ProposalVersion[];
  actions: ProposalAction[];
  calendar_event: CalendarEvent | null;
}

export interface TimeSlot {
  start: string;
  end: string;
}

export interface ConflictInfo {
  has_conflict: boolean;
  busy_times: TimeSlot[];
}
