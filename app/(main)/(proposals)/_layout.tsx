import { Stack } from "expo-router";
import { COLORS } from "@/lib/constants";

export default function ProposalsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.background },
        headerTintColor: COLORS.text,
      }}
    />
  );
}
