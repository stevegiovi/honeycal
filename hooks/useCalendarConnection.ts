import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface CalendarConnectionState {
  isConnected: boolean;
  isLoading: boolean;
}

export function useCalendarConnection(userId: string | undefined) {
  const [state, setState] = useState<CalendarConnectionState>({
    isConnected: false,
    isLoading: true,
  });

  const check = useCallback(async () => {
    if (!userId) {
      setState({ isConnected: false, isLoading: false });
      return;
    }

    const { data, error } = await supabase
      .from("google_calendar_connections")
      .select("id")
      .eq("profile_id", userId)
      .maybeSingle();

    setState({
      isConnected: !error && data !== null,
      isLoading: false,
    });
  }, [userId]);

  useEffect(() => {
    check();
  }, [check]);

  return { ...state, refresh: check };
}
