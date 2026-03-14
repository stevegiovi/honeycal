import React from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { useAuth } from "@/providers/AuthProvider";
import { usePartnership } from "@/providers/PartnershipProvider";
import { useCalendarConnection } from "@/hooks/useCalendarConnection";
import { Button } from "@/components/ui/Button";
import { COLORS } from "@/lib/constants";

export default function ProfileScreen() {
  const { user, profile, signOut } = useAuth();
  const { partnership, partner } = usePartnership();
  const { isConnected } = useCalendarConnection(user?.id);

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: signOut,
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Profile info */}
      <View style={styles.section}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile?.display_name ?? "?")[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{profile?.display_name ?? "—"}</Text>
        <Text style={styles.email}>{profile?.email ?? user?.email ?? "—"}</Text>
      </View>

      {/* Calendar status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Google Calendar</Text>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Status</Text>
          <Text
            style={[
              styles.cardValue,
              { color: isConnected ? COLORS.success : COLORS.error },
            ]}
          >
            {isConnected ? "Connected" : "Not connected"}
          </Text>
        </View>
      </View>

      {/* Partnership info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Partnership</Text>
        {partnership?.status === "active" && partner ? (
          <>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Partner</Text>
              <Text style={styles.cardValue}>{partner.display_name}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Status</Text>
              <Text style={[styles.cardValue, { color: COLORS.success }]}>
                Active
              </Text>
            </View>
          </>
        ) : partnership?.status === "pending" ? (
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Status</Text>
            <Text style={[styles.cardValue, { color: COLORS.warning }]}>
              Waiting for partner
            </Text>
          </View>
        ) : (
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Status</Text>
            <Text style={styles.cardValue}>No partnership</Text>
          </View>
        )}
      </View>

      <View style={styles.bottom}>
        <Button
          title="Sign Out"
          onPress={handleSignOut}
          variant="danger"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 20,
  },
  section: {
    alignItems: "center",
    marginBottom: 28,
    marginTop: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
  },
  email: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  cardLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.text,
  },
  bottom: {
    marginTop: "auto",
    paddingBottom: 20,
  },
});
