import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { usePartnership } from "@/providers/PartnershipProvider";
import {
  useCreateProposal,
  useProposalAction,
} from "@/hooks/useProposalMutations";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { COLORS } from "@/lib/constants";

export default function NewProposalScreen() {
  const params = useLocalSearchParams<{
    counterId?: string;
    title?: string;
    location?: string;
    proposedStart?: string;
    proposedEnd?: string;
    notes?: string;
  }>();

  const isCounter = !!params.counterId;
  const { partnership } = usePartnership();
  const { mutate: createProposal, isLoading: createLoading } =
    useCreateProposal();
  const { mutate: doAction, isLoading: actionLoading } = useProposalAction();

  const [title, setTitle] = useState(params.title ?? "");
  const [location, setLocation] = useState(params.location ?? "");
  const [notes, setNotes] = useState(params.notes ?? "");

  // Date/time as simple strings for MVP
  // In production, use a proper date picker
  const [date, setDate] = useState(() => {
    if (params.proposedStart) {
      return new Date(params.proposedStart).toISOString().split("T")[0];
    }
    return new Date().toISOString().split("T")[0];
  });
  const [startTime, setStartTime] = useState(() => {
    if (params.proposedStart) {
      const d = new Date(params.proposedStart);
      return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    }
    return "19:00";
  });
  const [endTime, setEndTime] = useState(() => {
    if (params.proposedEnd) {
      const d = new Date(params.proposedEnd);
      return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    }
    return "21:00";
  });

  const isLoading = createLoading || actionLoading;

  const buildTimestamp = (dateStr: string, timeStr: string) => {
    return new Date(`${dateStr}T${timeStr}:00`).toISOString();
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert("Error", "Title is required.");
      return;
    }
    if (!partnership?.id) {
      Alert.alert("Error", "No active partnership.");
      return;
    }

    const proposedStart = buildTimestamp(date, startTime);
    const proposedEnd = buildTimestamp(date, endTime);

    if (new Date(proposedEnd) <= new Date(proposedStart)) {
      Alert.alert("Error", "End time must be after start time.");
      return;
    }

    if (isCounter && params.counterId) {
      // Counter-propose via proposal-action Edge Function
      const { error } = await doAction({
        proposalId: params.counterId,
        action: "counter",
        version: {
          title: title.trim(),
          location: location.trim() || undefined,
          proposed_start: proposedStart,
          proposed_end: proposedEnd,
          notes: notes.trim() || undefined,
        },
      });

      if (error) {
        Alert.alert("Error", error);
        return;
      }

      router.back();
    } else {
      // Create new proposal via RPC
      const { proposalId, error } = await createProposal({
        partnershipId: partnership.id,
        title: title.trim(),
        proposedStart,
        proposedEnd,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (error) {
        Alert.alert("Error", error);
        return;
      }

      if (proposalId) {
        router.replace(`/(main)/(proposals)/${proposalId}`);
      } else {
        router.back();
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>
          {isCounter ? "Counter-Propose" : "New Proposal"}
        </Text>

        <TextInput
          label="Title"
          placeholder="e.g. Dinner at Sushi Roku"
          value={title}
          onChangeText={setTitle}
        />

        <TextInput
          label="Location (optional)"
          placeholder="e.g. 123 Main St"
          value={location}
          onChangeText={setLocation}
        />

        <TextInput
          label="Date"
          placeholder="YYYY-MM-DD"
          value={date}
          onChangeText={setDate}
        />

        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <TextInput
              label="Start Time"
              placeholder="HH:MM"
              value={startTime}
              onChangeText={setStartTime}
            />
          </View>
          <View style={styles.timeField}>
            <TextInput
              label="End Time"
              placeholder="HH:MM"
              value={endTime}
              onChangeText={setEndTime}
            />
          </View>
        </View>

        <TextInput
          label="Notes (optional)"
          placeholder="Any details to share..."
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          style={styles.notesInput}
        />

        <Button
          title={isCounter ? "Submit Counter-Proposal" : "Create Proposal"}
          onPress={handleSubmit}
          isLoading={isLoading}
          style={styles.submitButton}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 24,
  },
  timeRow: {
    flexDirection: "row",
    gap: 12,
  },
  timeField: {
    flex: 1,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  submitButton: {
    marginTop: 12,
  },
});
