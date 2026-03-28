import { Stack } from "expo-router";
import { COLORS } from "@/lib/constants";

export default function UpcomingLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.background },
        headerTintColor: COLORS.text,
      }}
    />
  );
}
