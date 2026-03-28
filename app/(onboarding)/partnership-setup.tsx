import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { usePartnership } from "@/providers/PartnershipProvider";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { COLORS } from "@/lib/constants";

type Mode = "choose" | "create" | "join";

export default function PartnershipSetupScreen() {
  const { createPartnership, joinPartnership, partnership } = usePartnership();
  const [mode, setMode] = useState<Mode>("choose");
  const [inviteCode, setInviteCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleCreate = async () => {
    setIsLoading(true);
    const { inviteCode: code, error } = await createPartnership();
    setIsLoading(false);

    if (error) {
      Alert.alert("Error", error);
      return;
    }

    setGeneratedCode(code);
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) {
      Alert.alert("Error", "Please enter an invite code.");
      return;
    }

    setIsLoading(true);
    const { error } = await joinPartnership(inviteCode.trim());
    setIsLoading(false);

    if (error) {
      Alert.alert("Error", error);
    }
    // Partnership provider will update and auth gate will redirect
  };

  const handleCopy = async () => {
    if (generatedCode) {
      await Clipboard.setStringAsync(generatedCode);
      Alert.alert("Copied", "Invite code copied to clipboard.");
    }
  };

  // Already in a pending partnership — show invite code
  if (partnership?.status === "pending") {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.icon}>💌</Text>
          <Text style={styles.title}>Waiting for Partner</Text>
          <Text style={styles.subtitle}>
            Share this code with your partner so they can join.
          </Text>
          <TouchableOpacity onPress={handleCopy} style={styles.codeBox}>
            <Text style={styles.codeText}>{partnership.invite_code}</Text>
            <Text style={styles.copyHint}>Tap to copy</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Choose mode
  if (mode === "choose") {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.icon}>🤝</Text>
          <Text style={styles.title}>Link with Your Partner</Text>
          <Text style={styles.subtitle}>
            Create a new partnership or join one with an invite code.
          </Text>
        </View>
        <View style={styles.buttons}>
          <Button
            title="Create Partnership"
            onPress={() => setMode("create")}
          />
          <Button
            title="Join with Invite Code"
            onPress={() => setMode("join")}
            variant="secondary"
          />
        </View>
      </View>
    );
  }

  // Create mode
  if (mode === "create") {
    if (generatedCode) {
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <Text style={styles.icon}>💌</Text>
            <Text style={styles.title}>Share This Code</Text>
            <Text style={styles.subtitle}>
              Send this invite code to your partner.
            </Text>
            <TouchableOpacity onPress={handleCopy} style={styles.codeBox}>
              <Text style={styles.codeText}>{generatedCode}</Text>
              <Text style={styles.copyHint}>Tap to copy</Text>
            </TouchableOpacity>
          </View>
          <Button
            title="Back"
            onPress={() => {
              setMode("choose");
              setGeneratedCode(null);
            }}
            variant="ghost"
          />
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Create Partnership</Text>
          <Text style={styles.subtitle}>
            Generate an invite code to share with your partner.
          </Text>
        </View>
        <View style={styles.buttons}>
          <Button
            title="Generate Invite Code"
            onPress={handleCreate}
            isLoading={isLoading}
          />
          <Button
            title="Back"
            onPress={() => setMode("choose")}
            variant="ghost"
          />
        </View>
      </View>
    );
  }

  // Join mode
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Join Partnership</Text>
        <Text style={styles.subtitle}>
          Enter the invite code your partner shared with you.
        </Text>
        <TextInput
          label="Invite Code"
          placeholder="e.g. a1b2c3d4e5f6"
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <View style={styles.buttons}>
        <Button
          title="Join"
          onPress={handleJoin}
          isLoading={isLoading}
        />
        <Button
          title="Back"
          onPress={() => setMode("choose")}
          variant="ghost"
        />
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
    marginBottom: 24,
  },
  codeBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 20,
    paddingHorizontal: 32,
    alignItems: "center",
    marginTop: 8,
  },
  codeText: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.primary,
    letterSpacing: 2,
  },
  copyHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 6,
  },
  buttons: {
    gap: 12,
  },
});
