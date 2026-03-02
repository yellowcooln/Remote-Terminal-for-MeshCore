import { Separator } from '../ui/separator';
import { RepeaterPane, NotFetched, KvRow, formatDuration } from './repeaterPaneShared';
import type { RepeaterStatusResponse, PaneState } from '../../types';

export function TelemetryPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: RepeaterStatusResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  return (
    <RepeaterPane title="Telemetry" state={state} onRefresh={onRefresh} disabled={disabled}>
      {!data ? (
        <NotFetched />
      ) : (
        <div className="space-y-2">
          <KvRow label="Battery" value={`${data.battery_volts.toFixed(3)}V`} />
          <KvRow label="Uptime" value={formatDuration(data.uptime_seconds)} />
          <KvRow label="TX Airtime" value={formatDuration(data.airtime_seconds)} />
          <KvRow label="RX Airtime" value={formatDuration(data.rx_airtime_seconds)} />
          <Separator className="my-1" />
          <KvRow label="Noise Floor" value={`${data.noise_floor_dbm} dBm`} />
          <KvRow label="Last RSSI" value={`${data.last_rssi_dbm} dBm`} />
          <KvRow label="Last SNR" value={`${data.last_snr_db.toFixed(1)} dB`} />
          <Separator className="my-1" />
          <KvRow
            label="Packets"
            value={`${data.packets_received.toLocaleString()} rx / ${data.packets_sent.toLocaleString()} tx`}
          />
          <KvRow
            label="Flood"
            value={`${data.recv_flood.toLocaleString()} rx / ${data.sent_flood.toLocaleString()} tx`}
          />
          <KvRow
            label="Direct"
            value={`${data.recv_direct.toLocaleString()} rx / ${data.sent_direct.toLocaleString()} tx`}
          />
          <KvRow
            label="Duplicates"
            value={`${data.flood_dups.toLocaleString()} flood / ${data.direct_dups.toLocaleString()} direct`}
          />
          <Separator className="my-1" />
          <KvRow label="TX Queue" value={data.tx_queue_len} />
          <KvRow label="Debug Flags" value={data.full_events} />
        </div>
      )}
    </RepeaterPane>
  );
}
