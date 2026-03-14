import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { usePartnership } from "@/providers/PartnershipProvider";
import { useUpcomingEvents, UpcomingEvent } from "@/hooks/useUpcomingEvents";
import { EventCard } from "@/components/EventCard";
import { COLORS } from "@/lib/constants";

export default function UpcomingScreen() {
  const { partnership } = usePartnership();
  const { data, isLoading, refetch } = useUpcomingEvents(partnership?.id);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const renderItem = ({ item }: { item: UpcomingEvent }) => (
    <EventCard
      event={item}
      onPress={() =>
        router.push(`/(main)/(proposals)/${item.proposal.id}`)
      }
    />
  );

  if (isLoading && data.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => item.proposal.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name="calendar-outline"
              size={48}
              color={COLORS.textTertiary}
            />
            <Text style={styles.emptyTitle}>No Upcoming Events</Text>
            <Text style={styles.emptySubtitle}>
              Finalized proposals will appear here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  empty: {
    alignItems: "center",
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 6,
    textAlign: "center",
  },
});
