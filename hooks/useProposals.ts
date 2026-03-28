import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ProposalWithVersion } from "@/lib/types";

export function useProposals(partnershipId: string | undefined) {
  const [data, setData] = useState<ProposalWithVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!partnershipId) {
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data: proposals, error: err } = await supabase
      .from("proposals")
      .select("*")
      .eq("partnership_id", partnershipId)
      .order("updated_at", { ascending: false });

    if (err) {
      setError(err.message);
      setIsLoading(false);
      return;
    }

    // Batch-load current versions
    const proposalIds = (proposals ?? []).map((p) => p.id);
    let versionsMap: Record<string, ProposalWithVersion["current_version_data"]> = {};

    if (proposalIds.length > 0) {
      const { data: versions } = await supabase
        .from("proposal_versions")
        .select("*")
        .in("proposal_id", proposalIds);

      if (versions) {
        for (const v of versions) {
          // Keep only the version matching current_version
          const proposal = (proposals ?? []).find((p) => p.id === v.proposal_id);
          if (proposal && v.version_number === proposal.current_version) {
            versionsMap[v.proposal_id] = v;
          }
        }
      }
    }

    const enriched: ProposalWithVersion[] = (proposals ?? []).map((p) => ({
      ...p,
      current_version_data: versionsMap[p.id] ?? null,
    }));

    setData(enriched);
    setIsLoading(false);
  }, [partnershipId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}
