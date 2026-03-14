import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/ui/Button";
import { COLORS } from "@/lib/constants";

export default function WelcomeScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>HoneyCal</Text>
        <Text style={styles.tagline}>
          Plan events together.{"\n"}One partnership, two calendars.
        </Text>
      </View>

      <View style={styles.buttons}>
        <Button
          title="Sign Up"
          onPress={() => router.push("/(auth)/sign-up")}
          style={styles.button}
        />
        <Button
          title="Sign In"
          onPress={() => router.push("/(auth)/sign-in")}
          variant="secondary"
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  hero: {
    alignItems: "center",
    marginBottom: 60,
  },
  logo: {
    fontSize: 42,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 12,
  },
  tagline: {
    fontSize: 17,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 24,
  },
  buttons: {
    gap: 12,
  },
  button: {
    width: "100%",
  },
});
