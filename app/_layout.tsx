import React, { useEffect } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { Slot, useRouter, useSegments } from "expo-router";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { PartnershipProvider, usePartnership } from "@/providers/PartnershipProvider";
import { COLORS } from "@/lib/constants";

function AuthGate() {
  const { session, isLoading: authLoading, isInitialized } = useAuth();
  const { partnership, isLoading: partnershipLoading } = usePartnership();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isInitialized || authLoading || partnershipLoading) return;

    const inAuth = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "(onboarding)";
    const inMain = segments[0] === "(main)";

    if (!session) {
      // Not signed in → auth screens
      if (!inAuth) {
        router.replace("/(auth)/welcome");
      }
    } else if (!partnership || partnership.status === "pending") {
      // Signed in but no active partnership → onboarding
      if (!inOnboarding) {
        if (!partnership) {
          router.replace("/(onboarding)/connect-calendar");
        } else {
          // Has pending partnership, show setup screen with invite code
          router.replace("/(onboarding)/partnership-setup");
        }
      }
    } else if (partnership.status === "active") {
      // Signed in with active partnership → main app
      if (!inMain) {
        router.replace("/(main)/(proposals)");
      }
    }
  }, [session, partnership, authLoading, partnershipLoading, isInitialized, segments]);

  if (!isInitialized || authLoading || partnershipLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <PartnershipProvider>
        <AuthGate />
      </PartnershipProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
});
