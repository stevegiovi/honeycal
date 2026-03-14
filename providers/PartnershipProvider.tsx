import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import type { Partnership, Profile } from "@/lib/types";

interface PartnershipState {
  partnership: Partnership | null;
  partner: Profile | null;
  isLoading: boolean;
}

type PartnershipAction =
  | { type: "LOADING" }
  | {
      type: "LOADED";
      partnership: Partnership | null;
      partner: Profile | null;
    }
  | { type: "CLEARED" };

const initialState: PartnershipState = {
  partnership: null,
  partner: null,
  isLoading: true,
};

function reducer(
  state: PartnershipState,
  action: PartnershipAction,
): PartnershipState {
  switch (action.type) {
    case "LOADING":
      return { ...state, isLoading: true };
    case "LOADED":
      return {
        partnership: action.partnership,
        partner: action.partner,
        isLoading: false,
      };
    case "CLEARED":
      return { ...initialState, isLoading: false };
    default:
      return state;
  }
}

interface PartnershipContextValue extends PartnershipState {
  refresh: () => Promise<void>;
  createPartnership: () => Promise<{
    inviteCode: string | null;
    error: string | null;
  }>;
  joinPartnership: (
    inviteCode: string,
  ) => Promise<{ error: string | null }>;
}

const PartnershipContext = createContext<PartnershipContextValue | null>(null);

export function PartnershipProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadPartnership = useCallback(async () => {
    if (!user) {
      dispatch({ type: "CLEARED" });
      return;
    }

    dispatch({ type: "LOADING" });

    // Fetch partnerships where user is partner_a or partner_b (active or pending)
    const { data: partnerships, error } = await supabase
      .from("partnerships")
      .select("*")
      .or(`partner_a_id.eq.${user.id},partner_b_id.eq.${user.id}`)
      .in("status", ["active", "pending"])
      .limit(1);

    if (error || !partnerships || partnerships.length === 0) {
      dispatch({ type: "LOADED", partnership: null, partner: null });
      return;
    }

    const partnership = partnerships[0] as Partnership;

    // Load partner profile if partnership is active
    let partner: Profile | null = null;
    if (partnership.status === "active") {
      const partnerId =
        partnership.partner_a_id === user.id
          ? partnership.partner_b_id
          : partnership.partner_a_id;

      if (partnerId) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", partnerId)
          .single();
        partner = data as Profile | null;
      }
    }

    dispatch({ type: "LOADED", partnership, partner });
  }, [user]);

  useEffect(() => {
    loadPartnership();
  }, [loadPartnership]);

  const createPartnership = useCallback(async () => {
    if (!user) return { inviteCode: null, error: "Not authenticated" };

    const { data, error } = await supabase
      .from("partnerships")
      .insert({ partner_a_id: user.id })
      .select()
      .single();

    if (error) return { inviteCode: null, error: error.message };

    await loadPartnership();
    return { inviteCode: (data as Partnership).invite_code, error: null };
  }, [user, loadPartnership]);

  const joinPartnership = useCallback(
    async (inviteCode: string) => {
      const { error } = await supabase.rpc("join_partnership", {
        p_invite_code: inviteCode,
      });

      if (error) return { error: error.message };

      await loadPartnership();
      return { error: null };
    },
    [loadPartnership],
  );

  return (
    <PartnershipContext.Provider
      value={{
        ...state,
        refresh: loadPartnership,
        createPartnership,
        joinPartnership,
      }}
    >
      {children}
    </PartnershipContext.Provider>
  );
}

export function usePartnership(): PartnershipContextValue {
  const ctx = useContext(PartnershipContext);
  if (!ctx)
    throw new Error("usePartnership must be used within PartnershipProvider");
  return ctx;
}
