import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS, STATUS_LABELS } from "@/lib/constants";
import type { ProposalStatus } from "@/lib/types";

interface StatusBadgeProps {
  status: ProposalStatus;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  proposed: { bg: "#FFF3E0", text: COLORS.primary },
  counter_proposed: { bg: "#FFF3E0", text: COLORS.primaryDark },
  accepted: { bg: "#E8F5E9", text: COLORS.accepted },
  finalized: { bg: "#E8F5E9", text: COLORS.finalized },
  declined: { bg: "#FFEBEE", text: COLORS.declined },
  withdrawn: { bg: "#F5F5F5", text: COLORS.withdrawn },
  cancelled: { bg: "#F5F5F5", text: COLORS.cancelled },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.proposed;

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.text }]}>
        {STATUS_LABELS[status] ?? status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
});
