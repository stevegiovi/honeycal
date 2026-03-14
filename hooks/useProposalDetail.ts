import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ProposalDetail } from "@/lib/types";

export function useProposalDetail(proposalId: string | undefined) {
  const [data, setData] = useState<ProposalDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!proposalId) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Fetch proposal, versions, actions, and calendar_event in parallel
    const [proposalRes, versionsRes, actionsRes, calEventRes] =
      await Promise.all([
        supabase
          .from("proposals")
          .select("*")
          .eq("id", proposalId)
          .single(),
        supabase
          .from("proposal_versions")
          .select("*")
          .eq("proposal_id", proposalId)
          .order("version_number", { ascending: true }),
        supabase
          .from("proposal_actions")
          .select("*")
          .eq("proposal_id", proposalId)
          .order("created_at", { ascending: true }),
        supabase
          .from("calendar_events")
          .select("*")
          .eq("proposal_id", proposalId)
          .maybeSingle(),
      ]);

    if (proposalRes.error) {
      setError(proposalRes.error.message);
      setIsLoading(false);
      return;
    }

    const detail: ProposalDetail = {
      ...proposalRes.data,
      versions: versionsRes.data ?? [],
      actions: actionsRes.data ?? [],
      calendar_event: calEventRes.data ?? null,
    };

    setData(detail);
    setIsLoading(false);
  }, [proposalId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}
