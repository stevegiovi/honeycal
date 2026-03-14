import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ProposalVersion } from "@/lib/types";

interface MutationState {
  isLoading: boolean;
  error: string | null;
}

export function useCreateProposal() {
  const [state, setState] = useState<MutationState>({
    isLoading: false,
    error: null,
  });

  const mutate = useCallback(
    async (params: {
      partnershipId: string;
      title: string;
      proposedStart: string;
      proposedEnd: string;
      location?: string;
      notes?: string;
    }) => {
      setState({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("create_proposal", {
        p_partnership_id: params.partnershipId,
        p_title: params.title,
        p_proposed_start: params.proposedStart,
        p_proposed_end: params.proposedEnd,
        p_location: params.location ?? null,
        p_notes: params.notes ?? null,
      });

      if (error) {
        setState({ isLoading: false, error: error.message });
        return { proposalId: null, error: error.message };
      }

      setState({ isLoading: false, error: null });
      return { proposalId: data as string, error: null };
    },
    [],
  );

  return { ...state, mutate };
}

export function useProposalAction() {
  const [state, setState] = useState<MutationState>({
    isLoading: false,
    error: null,
  });

  const mutate = useCallback(
    async (params: {
      proposalId: string;
      action: "accept" | "counter" | "decline" | "withdraw" | "retry_finalize";
      version?: {
        title: string;
        location?: string;
        proposed_start: string;
        proposed_end: string;
        notes?: string;
      };
      note?: string;
    }) => {
      setState({ isLoading: true, error: null });

      const { data, error } = await supabase.functions.invoke(
        "proposal-action",
        {
          body: {
            proposal_id: params.proposalId,
            action: params.action,
            version: params.version,
            note: params.note,
          },
        },
      );

      if (error) {
        setState({ isLoading: false, error: error.message });
        return { error: error.message };
      }

      setState({ isLoading: false, error: null });
      return { data, error: null };
    },
    [],
  );

  return { ...state, mutate };
}

export function useCancelEvent() {
  const [state, setState] = useState<MutationState>({
    isLoading: false,
    error: null,
  });

  const mutate = useCallback(async (proposalId: string) => {
    setState({ isLoading: true, error: null });

    const { error } = await supabase.functions.invoke("cancel-event", {
      body: { proposal_id: proposalId },
    });

    if (error) {
      setState({ isLoading: false, error: error.message });
      return { error: error.message };
    }

    setState({ isLoading: false, error: null });
    return { error: null };
  }, []);

  return { ...state, mutate };
}
