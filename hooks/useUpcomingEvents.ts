import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Proposal, ProposalVersion } from "@/lib/types";

export interface UpcomingEvent {
  proposal: Proposal;
  version: ProposalVersion;
}

export function useUpcomingEvents(partnershipId: string | undefined) {
  const [data, setData] = useState<UpcomingEvent[]>([]);
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

    // Get finalized proposals
    const { data: proposals, error: err } = await supabase
      .from("proposals")
      .select("*")
      .eq("partnership_id", partnershipId)
      .eq("status", "finalized")
      .order("updated_at", { ascending: false });

    if (err) {
      setError(err.message);
      setIsLoading(false);
      return;
    }

    if (!proposals || proposals.length === 0) {
      setData([]);
      setIsLoading(false);
      return;
    }

    // Get current versions for each
    const proposalIds = proposals.map((p) => p.id);
    const { data: versions } = await supabase
      .from("proposal_versions")
      .select("*")
      .in("proposal_id", proposalIds);

    const versionMap: Record<string, ProposalVersion> = {};
    if (versions) {
      for (const v of versions) {
        const proposal = proposals.find((p) => p.id === v.proposal_id);
        if (proposal && v.version_number === proposal.current_version) {
          versionMap[v.proposal_id] = v;
        }
      }
    }

    const events: UpcomingEvent[] = proposals
      .filter((p) => versionMap[p.id])
      .map((p) => ({ proposal: p, version: versionMap[p.id] }))
      .sort(
        (a, b) =>
          new Date(a.version.proposed_start).getTime() -
          new Date(b.version.proposed_start).getTime(),
      );

    setData(events);
    setIsLoading(false);
  }, [partnershipId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}
