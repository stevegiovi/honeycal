import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { COLORS } from "@/lib/constants";
import type { UpcomingEvent } from "@/hooks/useUpcomingEvents";

interface EventCardProps {
  event: UpcomingEvent;
  onPress: () => void;
}

export function EventCard({ event, onPress }: EventCardProps) {
  const { version } = event;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.card}
      activeOpacity={0.7}
    >
      <View style={styles.dateBox}>
        <Text style={styles.dateDay}>
          {new Date(version.proposed_start).getDate()}
        </Text>
        <Text style={styles.dateMonth}>
          {new Date(version.proposed_start).toLocaleDateString("en-US", {
            month: "short",
          })}
        </Text>
      </View>
      <View style={styles.details}>
        <Text style={styles.title} numberOfLines={1}>
          {version.title}
        </Text>
        <Text style={styles.time}>
          {formatTime(version.proposed_start)} –{" "}
          {formatTime(version.proposed_end)}
        </Text>
        {version.location && (
          <Text style={styles.location} numberOfLines={1}>
            {version.location}
          </Text>
        )}
      </View>
      <View style={styles.syncBadge}>
        <Text style={styles.syncText}>Synced</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dateBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  dateDay: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.primaryDark,
  },
  dateMonth: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.primaryDark,
    textTransform: "uppercase",
  },
  details: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 2,
  },
  time: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  location: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  syncBadge: {
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginLeft: 8,
  },
  syncText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.success,
  },
});
