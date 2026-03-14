import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { COLORS } from "@/lib/constants";
import { StatusBadge } from "./ui/StatusBadge";
import type { ProposalWithVersion } from "@/lib/types";

interface ProposalCardProps {
  proposal: ProposalWithVersion;
  currentUserId: string;
  onPress: () => void;
}

export function ProposalCard({
  proposal,
  currentUserId,
  onPress,
}: ProposalCardProps) {
  const version = proposal.current_version_data;
  const isMyTurn = proposal.pending_actor_id === currentUserId;
  const isTerminal = [
    "finalized",
    "withdrawn",
    "declined",
    "cancelled",
  ].includes(proposal.status);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.card, isMyTurn && styles.cardMyTurn]}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {version?.title ?? "Untitled Proposal"}
        </Text>
        <StatusBadge status={proposal.status} />
      </View>

      {version && (
        <Text style={styles.time}>{formatDate(version.proposed_start)}</Text>
      )}

      {version?.location && (
        <Text style={styles.location} numberOfLines={1}>
          {version.location}
        </Text>
      )}

      {!isTerminal && (
        <View style={styles.footer}>
          <View
            style={[
              styles.turnBadge,
              { backgroundColor: isMyTurn ? COLORS.yourTurn : COLORS.waiting },
            ]}
          >
            <Text style={styles.turnText}>
              {isMyTurn ? "Your turn" : "Waiting"}
            </Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardMyTurn: {
    borderColor: COLORS.yourTurn,
    borderWidth: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  location: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginBottom: 8,
  },
  footer: {
    flexDirection: "row",
    marginTop: 4,
  },
  turnBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  turnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
