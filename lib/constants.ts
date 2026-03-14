export const TERMINAL_STATUSES = [
  "finalized",
  "withdrawn",
  "declined",
  "cancelled",
] as const;

export const COLORS = {
  primary: "#D4845A",
  primaryLight: "#F5E6D3",
  primaryDark: "#B86B3F",
  background: "#FFFAF5",
  surface: "#FFFFFF",
  text: "#1A1A1A",
  textSecondary: "#6B6B6B",
  textTertiary: "#999999",
  border: "#E8E0D8",
  error: "#D64545",
  success: "#2D8A4E",
  warning: "#E6A817",
  yourTurn: "#D4845A",
  waiting: "#8B9DAF",
  accepted: "#2D8A4E",
  declined: "#D64545",
  withdrawn: "#999999",
  finalized: "#2D8A4E",
  cancelled: "#999999",
} as const;

export const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  counter_proposed: "Counter-Proposed",
  accepted: "Accepted",
  finalized: "Finalized",
  withdrawn: "Withdrawn",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const ACTION_LABELS: Record<string, string> = {
  proposed: "Proposed",
  countered: "Counter-proposed",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  finalized: "Finalized",
  cancelled: "Cancelled",
};
