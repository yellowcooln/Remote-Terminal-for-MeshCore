import { useMemo, lazy, Suspense } from 'react';
import { cn } from '@/lib/utils';
import { RepeaterPane, NotFetched, formatDuration } from './repeaterPaneShared';
import { isValidLocation, calculateDistance, formatDistance } from '../../utils/pathUtils';
import type { Contact, RepeaterNeighborsResponse, PaneState, NeighborInfo } from '../../types';

const NeighborsMiniMap = lazy(() =>
  import('../NeighborsMiniMap').then((m) => ({ default: m.NeighborsMiniMap }))
);

export function NeighborsPane({
  data,
  state,
  onRefresh,
  disabled,
  contacts,
  radioLat,
  radioLon,
  radioName,
}: {
  data: RepeaterNeighborsResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
  contacts: Contact[];
  radioLat: number | null;
  radioLon: number | null;
  radioName: string | null;
}) {
  // Resolve contact data for each neighbor in a single pass — used for
  // coords (mini-map), distances (table column), and sorted display order.
  const { neighborsWithCoords, sorted, hasDistances } = useMemo(() => {
    if (!data) {
      return {
        neighborsWithCoords: [] as Array<NeighborInfo & { lat: number | null; lon: number | null }>,
        sorted: [] as Array<NeighborInfo & { distance: string | null }>,
        hasDistances: false,
      };
    }

    const withCoords: Array<NeighborInfo & { lat: number | null; lon: number | null }> = [];
    const enriched: Array<NeighborInfo & { distance: string | null }> = [];
    let anyDist = false;

    for (const n of data.neighbors) {
      const contact = contacts.find((c) => c.public_key.startsWith(n.pubkey_prefix));
      const nLat = contact?.lat ?? null;
      const nLon = contact?.lon ?? null;

      let dist: string | null = null;
      if (isValidLocation(radioLat, radioLon) && isValidLocation(nLat, nLon)) {
        const distKm = calculateDistance(radioLat, radioLon, nLat, nLon);
        if (distKm != null) {
          dist = formatDistance(distKm);
          anyDist = true;
        }
      }
      enriched.push({ ...n, distance: dist });

      if (isValidLocation(nLat, nLon)) {
        withCoords.push({ ...n, lat: nLat, lon: nLon });
      }
    }

    enriched.sort((a, b) => b.snr - a.snr);

    return {
      neighborsWithCoords: withCoords,
      sorted: enriched,
      hasDistances: anyDist,
    };
  }, [data, contacts, radioLat, radioLon]);

  return (
    <RepeaterPane
      title="Neighbors"
      state={state}
      onRefresh={onRefresh}
      disabled={disabled}
      className="flex flex-col"
      contentClassName="flex-1 flex flex-col"
    >
      {!data ? (
        <NotFetched />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No neighbors reported</p>
      ) : (
        <div className="flex-1 flex flex-col gap-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground text-xs">
                  <th className="pb-1 font-medium">Name</th>
                  <th className="pb-1 font-medium text-right">SNR</th>
                  {hasDistances && <th className="pb-1 font-medium text-right">Dist</th>}
                  <th className="pb-1 font-medium text-right">Last Heard</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((n, i) => {
                  const dist = n.distance;
                  const snrStr = n.snr >= 0 ? `+${n.snr.toFixed(1)}` : n.snr.toFixed(1);
                  const snrColor =
                    n.snr >= 6 ? 'text-green-400' : n.snr >= 0 ? 'text-yellow-500' : 'text-red-400';
                  return (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1">{n.name || n.pubkey_prefix}</td>
                      <td className={cn('py-1 text-right font-mono', snrColor)}>{snrStr} dB</td>
                      {hasDistances && (
                        <td className="py-1 text-right text-muted-foreground font-mono">
                          {dist ?? '—'}
                        </td>
                      )}
                      <td className="py-1 text-right text-muted-foreground">
                        {formatDuration(n.last_heard_seconds)} ago
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(neighborsWithCoords.length > 0 || isValidLocation(radioLat, radioLon)) && (
            <Suspense
              fallback={
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  Loading map...
                </div>
              }
            >
              <NeighborsMiniMap
                key={neighborsWithCoords.map((n) => n.pubkey_prefix).join(',')}
                neighbors={neighborsWithCoords}
                radioLat={radioLat}
                radioLon={radioLon}
                radioName={radioName}
              />
            </Suspense>
          )}
        </div>
      )}
    </RepeaterPane>
  );
}
