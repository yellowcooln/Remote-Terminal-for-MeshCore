import { RepeaterPane, NotFetched, LppSensorRow } from './repeaterPaneShared';
import type { RepeaterLppTelemetryResponse, PaneState } from '../../types';

export function LppTelemetryPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: RepeaterLppTelemetryResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  return (
    <RepeaterPane title="LPP Sensors" state={state} onRefresh={onRefresh} disabled={disabled}>
      {!data ? (
        <NotFetched />
      ) : data.sensors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sensor data available</p>
      ) : (
        <div className="space-y-0.5">
          {data.sensors.map((sensor, i) => (
            <LppSensorRow key={i} sensor={sensor} />
          ))}
        </div>
      )}
    </RepeaterPane>
  );
}
