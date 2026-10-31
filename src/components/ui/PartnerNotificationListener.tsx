import { useEffect, useRef } from "react";
import { useToast } from "./Toast";
import { subscribePartners, type PartnerServer } from "../../lib/partners";

/**
 * PartnerNotificationListener — watches the live partner list and pops a
 * toast notification the moment a NEW partnership server is added.
 *
 * - On first fetch, it records the existing partner IDs silently (no spam).
 * - Any partner ID that appears AFTER the initial load triggers a toast.
 * - Works in real-time: Tauri polls every ~4s, browser uses Firebase realtime.
 */
export function PartnerNotificationListener() {
  const { toast } = useToast();
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    const unsub = subscribePartners((list: PartnerServer[]) => {
      const currentIds = new Set(list.map((p) => p.id || p.ip));

      // First fetch: just record existing IDs, don't notify.
      if (knownIds.current === null) {
        knownIds.current = currentIds;
        return;
      }

      // Find NEW partner IDs that weren't in the previous set.
      const newPartners = list.filter((p) => {
        const id = p.id || p.ip;
        return !knownIds.current!.has(id);
      });

      if (newPartners.length > 0) {
        for (const np of newPartners) {
          toast(
            "success",
            "New Partner Server Added!",
            `${np.name} just joined Xryloth as a partner. Check it out on the Partners page!`,
            6000
          );
        }
        // Update the known set with the new IDs.
        for (const id of currentIds) {
          knownIds.current!.add(id);
        }
      }
    });
    return () => unsub();
  }, [toast]);

  return null;
}
