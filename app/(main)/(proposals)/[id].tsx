import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { useAuth } from "@/providers/AuthProvider";
import { usePartnership } from "@/providers/PartnershipProvider";
import { useProposalDetail } from "@/hooks/useProposalDetail";
import {
  useProposalAction,
  useCancelEvent,
} from "@/hooks/useProposalMutations";
import { ActionTimeline } from "@/components/ActionTimeline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { COLORS, TERMINAL_STATUSES } from "@/lib/constants";

export default function ProposalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { partner } = usePartnership();
  const { data: proposal, isLoading, refetch } = useProposalDetail(id);
  const { mutate: doAction, isLoading: actionLoading } = useProposalAction();
  const { mutate: cancelEvent, isLoading: cancelLoading } = useCancelEvent();

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  if (isLoading || !proposal) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const currentVersion =
    proposal.versions.find(
      (v) => v.version_number === proposal.current_version,
    ) ?? proposal.versions[proposal.versions.length - 1];

  const isMyTurn = proposal.pending_actor_id === user?.id;
  const isTerminal = TERMINAL_STATUSES.includes(proposal.status as any);
  const isFinalized = proposal.status === "finalized";
  const isAccepted = proposal.status === "accepted";

  const handleAction = async (
    action: "accept" | "decline" | "withdraw",
  ) => {
    const labels = {
      accept: "Accept this proposal?",
      decline: "Decline this proposal?",
      withdraw: "Withdraw this proposal?",
    };
    Alert.alert("Confirm", labels[action], [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        style: action === "accept" ? "default" : "destructive",
        onPress: async () => {
          const { error } = await doAction({
            proposalId: proposal.id,
            action,
          });
          if (error) {
            Alert.alert("Error", error);
          } else {
            refetch();
          }
        },
      },
    ]);
  };

  const handleCounter = () => {
    router.push({
      pathname: "/(main)/(proposals)/new",
      params: {
        counterId: proposal.id,
        title: currentVersion?.title ?? "",
        location: currentVersion?.location ?? "",
        proposedStart: currentVersion?.proposed_start ?? "",
        proposedEnd: currentVersion?.proposed_end ?? "",
        notes: currentVersion?.notes ?? "",
      },
    });
  };

  const handleCancel = () => {
    Alert.alert(
      "Cancel Event",
      "This will remove the event from both Google Calendars.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel Event",
          style: "destructive",
          onPress: async () => {
            const { error } = await cancelEvent(proposal.id);
            if (error) {
              Alert.alert("Error", error);
            } else {
              refetch();
            }
          },
        },
      ],
    );
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={refetch}
          tintColor={COLORS.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{currentVersion?.title ?? "Proposal"}</Text>
        <StatusBadge status={proposal.status} />
      </View>

      {/* Details */}
      <View style={styles.detailsCard}>
        {currentVersion && (
          <>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>When</Text>
              <Text style={styles.detailValue}>
                {formatDateTime(currentVersion.proposed_start)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Until</Text>
              <Text style={styles.detailValue}>
                {formatDateTime(currentVersion.proposed_end)}
              </Text>
            </View>
            {currentVersion.location && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Where</Text>
                <Text style={styles.detailValue}>
                  {currentVersion.location}
                </Text>
              </View>
            )}
            {currentVersion.notes && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Notes</Text>
                <Text style={styles.detailValue}>{currentVersion.notes}</Text>
              </View>
            )}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Version</Text>
              <Text style={styles.detailValue}>
                {currentVersion.version_number}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Actions */}
      {!isTerminal && (
        <View style={styles.actions}>
          {isMyTurn && (
            <>
              <Button
                title="Accept"
                onPress={() => handleAction("accept")}
                isLoading={actionLoading}
                style={styles.actionButton}
              />
              <Button
                title="Counter-Propose"
                onPress={handleCounter}
                variant="secondary"
                style={styles.actionButton}
              />
              <Button
                title="Decline"
                onPress={() => handleAction("decline")}
                variant="danger"
                style={styles.actionButton}
              />
            </>
          )}
          {!isMyTurn && !isAccepted && (
            <Text style={styles.waitingText}>
              Waiting for {partner?.display_name ?? "partner"}...
            </Text>
          )}
          <Button
            title="Withdraw"
            onPress={() => handleAction("withdraw")}
            variant="ghost"
            style={styles.actionButton}
          />
        </View>
      )}

      {/* Cancel finalized */}
      {isFinalized && (
        <View style={styles.actions}>
          <Button
            title="Cancel Event"
            onPress={handleCancel}
            variant="danger"
            isLoading={cancelLoading}
          />
        </View>
      )}

      {/* Timeline */}
      <ActionTimeline
        actions={proposal.actions}
        currentUserId={user?.id ?? ""}
        partnerName={partner?.display_name ?? "Partner"}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    flex: 1,
    marginRight: 12,
  },
  detailsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  detailLabel: {
    width: 72,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  detailValue: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  actions: {
    marginTop: 20,
    gap: 10,
  },
  actionButton: {
    width: "100%",
  },
  waitingText: {
    textAlign: "center",
    fontSize: 15,
    color: COLORS.textSecondary,
    paddingVertical: 8,
  },
});
