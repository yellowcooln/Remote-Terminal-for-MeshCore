import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import {
  RepeaterPane,
  RefreshIcon,
  NotFetched,
  KvRow,
  formatClockDrift,
  formatAdvertInterval,
} from './repeaterPaneShared';
import type {
  RepeaterRadioSettingsResponse,
  RepeaterAdvertIntervalsResponse,
  PaneState,
} from '../../types';

export function RadioSettingsPane({
  data,
  state,
  onRefresh,
  disabled,
  advertData,
  advertState,
  onRefreshAdvert,
}: {
  data: RepeaterRadioSettingsResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
  advertData: RepeaterAdvertIntervalsResponse | null;
  advertState: PaneState;
  onRefreshAdvert: () => void;
}) {
  const clockDrift = useMemo(() => {
    if (!data?.clock_utc) return null;
    return formatClockDrift(data.clock_utc);
  }, [data?.clock_utc]);

  return (
    <RepeaterPane title="Radio Settings" state={state} onRefresh={onRefresh} disabled={disabled}>
      {!data ? (
        <NotFetched />
      ) : (
        <div>
          <KvRow label="Firmware" value={data.firmware_version ?? '—'} />
          <KvRow label="Radio" value={data.radio ?? '—'} />
          <KvRow label="TX Power" value={data.tx_power != null ? `${data.tx_power} dBm` : '—'} />
          <KvRow label="Airtime Factor" value={data.airtime_factor ?? '—'} />
          <KvRow label="Repeat Mode" value={data.repeat_enabled ?? '—'} />
          <KvRow label="Max Flood Hops" value={data.flood_max ?? '—'} />
          <Separator className="my-1" />
          <KvRow label="Name" value={data.name ?? '—'} />
          <KvRow
            label="Lat / Lon"
            value={
              data.lat != null || data.lon != null ? `${data.lat ?? '—'}, ${data.lon ?? '—'}` : '—'
            }
          />
          <Separator className="my-1" />
          <div className="flex justify-between text-sm py-0.5">
            <span className="text-muted-foreground">Clock (UTC)</span>
            <span>
              {data.clock_utc ?? '—'}
              {clockDrift && (
                <span
                  className={cn(
                    'ml-2 text-xs',
                    clockDrift.isLarge ? 'text-red-500' : 'text-muted-foreground'
                  )}
                >
                  (drift: {clockDrift.text})
                </span>
              )}
            </span>
          </div>
        </div>
      )}
      {/* Advert Intervals sub-section */}
      <Separator className="my-2" />
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">Advert Intervals</span>
        <button
          type="button"
          onClick={onRefreshAdvert}
          disabled={disabled || advertState.loading}
          className={cn(
            'p-1 rounded transition-colors disabled:opacity-50',
            disabled || advertState.loading
              ? 'text-muted-foreground'
              : 'text-green-500 hover:bg-accent hover:text-green-400'
          )}
          title="Refresh Advert Intervals"
        >
          <RefreshIcon
            className={cn(
              'w-3 h-3',
              advertState.loading && 'animate-spin [animation-direction:reverse]'
            )}
          />
        </button>
      </div>
      {advertState.error && <p className="text-xs text-destructive mb-1">{advertState.error}</p>}
      {advertState.loading ? (
        <p className="text-sm text-muted-foreground italic">
          Fetching{advertState.attempt > 1 ? ` (attempt ${advertState.attempt}/3)` : ''}...
        </p>
      ) : !advertData ? (
        <NotFetched />
      ) : (
        <div>
          <KvRow label="Local Advert" value={formatAdvertInterval(advertData.advert_interval)} />
          <KvRow
            label="Flood Advert"
            value={formatAdvertInterval(advertData.flood_advert_interval)}
          />
        </div>
      )}
    </RepeaterPane>
  );
}
