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
import { useAuth } from "@/providers/AuthProvider";
import { usePartnership } from "@/providers/PartnershipProvider";
import { useProposals } from "@/hooks/useProposals";
import { ProposalCard } from "@/components/ProposalCard";
import { Button } from "@/components/ui/Button";
import { COLORS } from "@/lib/constants";
import type { ProposalWithVersion } from "@/lib/types";

export default function ProposalFeedScreen() {
  const { user } = useAuth();
  const { partnership } = usePartnership();
  const { data, isLoading, refetch } = useProposals(partnership?.id);

  // Refetch on screen focus (deterministic fetch pattern)
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const handlePress = (proposal: ProposalWithVersion) => {
    router.push(`/(main)/(proposals)/${proposal.id}`);
  };

  const renderItem = ({ item }: { item: ProposalWithVersion }) => (
    <ProposalCard
      proposal={item}
      currentUserId={user?.id ?? ""}
      onPress={() => handlePress(item)}
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
        keyExtractor={(item) => item.id}
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
              name="chatbubbles-outline"
              size={48}
              color={COLORS.textTertiary}
            />
            <Text style={styles.emptyTitle}>No Proposals Yet</Text>
            <Text style={styles.emptySubtitle}>
              Create your first proposal to start planning together.
            </Text>
          </View>
        }
      />
      <View style={styles.fab}>
        <Button
          title="+ New Proposal"
          onPress={() => router.push("/(main)/(proposals)/new")}
        />
      </View>
    </View>
  );
}

export const unstable_settings = {
  initialRouteName: "index",
};

export { ProposalFeedScreen };

// Screen options
ProposalFeedScreen.screenOptions = {
  title: "Proposals",
};
