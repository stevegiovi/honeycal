import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/providers/AuthProvider";
import { useCalendarConnection } from "@/hooks/useCalendarConnection";
import { COLORS } from "@/lib/constants";

export default function ConnectCalendarScreen() {
  const { user } = useAuth();
  const { isConnected, isLoading } = useCalendarConnection(user?.id);

  const handleConnect = () => {
    // In a real implementation, this would launch the Google OAuth flow
    // using expo-auth-session, then send the auth code to the
    // google-auth-callback Edge Function.
    // For MVP, we show the intent and skip to partnership setup.
    router.push("/(onboarding)/partnership-setup");
  };

  const handleSkip = () => {
    router.push("/(onboarding)/partnership-setup");
  };

  if (isConnected) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.checkmark}>✓</Text>
          <Text style={styles.title}>Calendar Connected</Text>
          <Text style={styles.subtitle}>
            Your Google Calendar is linked. You're ready to go.
          </Text>
        </View>
        <Button
          title="Continue"
          onPress={() => router.push("/(onboarding)/partnership-setup")}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>📅</Text>
        <Text style={styles.title}>Connect Your Calendar</Text>
        <Text style={styles.subtitle}>
          HoneyCal reads both partners' Google Calendars to find conflict-free
          times and writes finalized events to both.
        </Text>
        <Text style={styles.detail}>
          We'll request access to view free/busy times and create events.
          Your calendar data stays on Google — we never store it.
        </Text>
      </View>

      <View style={styles.buttons}>
        <Button title="Connect Google Calendar" onPress={handleConnect} />
        <Button title="Skip for now" onPress={handleSkip} variant="ghost" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 32,
    paddingBottom: 40,
    justifyContent: "space-between",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  icon: {
    fontSize: 56,
    marginBottom: 20,
  },
  checkmark: {
    fontSize: 56,
    color: COLORS.success,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 16,
  },
  detail: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 20,
  },
  buttons: {
    gap: 12,
  },
});
