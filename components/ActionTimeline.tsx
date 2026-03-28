import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS, ACTION_LABELS } from "@/lib/constants";
import type { ProposalAction, Profile } from "@/lib/types";

interface ActionTimelineProps {
  actions: ProposalAction[];
  currentUserId: string;
  partnerName: string;
}

export function ActionTimeline({
  actions,
  currentUserId,
  partnerName,
}: ActionTimelineProps) {
  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getActorName = (actorId: string | null) => {
    if (!actorId) return "System";
    return actorId === currentUserId ? "You" : partnerName;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>History</Text>
      {actions.map((action, index) => (
        <View key={action.id} style={styles.item}>
          <View style={styles.dotColumn}>
            <View style={styles.dot} />
            {index < actions.length - 1 && <View style={styles.line} />}
          </View>
          <View style={styles.content}>
            <Text style={styles.actionText}>
              <Text style={styles.actor}>{getActorName(action.actor_id)}</Text>
              {" "}
              {ACTION_LABELS[action.action] ?? action.action}
              {action.version_number ? ` (v${action.version_number})` : ""}
            </Text>
            {action.note && <Text style={styles.note}>{action.note}</Text>}
            <Text style={styles.timestamp}>
              {formatTime(action.created_at)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
  },
  heading: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 12,
  },
  item: {
    flexDirection: "row",
    marginBottom: 4,
  },
  dotColumn: {
    width: 24,
    alignItems: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginTop: 4,
  },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: COLORS.border,
    marginVertical: 2,
  },
  content: {
    flex: 1,
    paddingBottom: 16,
    paddingLeft: 8,
  },
  actionText: {
    fontSize: 15,
    color: COLORS.text,
  },
  actor: {
    fontWeight: "600",
  },
  note: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: "italic",
    marginTop: 2,
  },
  timestamp: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
});
