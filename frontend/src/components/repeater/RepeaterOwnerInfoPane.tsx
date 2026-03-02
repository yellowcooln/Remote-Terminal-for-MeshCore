import { RepeaterPane, NotFetched, KvRow } from './repeaterPaneShared';
import type { RepeaterOwnerInfoResponse, PaneState } from '../../types';

export function OwnerInfoPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: RepeaterOwnerInfoResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  return (
    <RepeaterPane title="Owner Info" state={state} onRefresh={onRefresh} disabled={disabled}>
      {!data ? (
        <NotFetched />
      ) : (
        <div className="break-all">
          <KvRow label="Owner Info" value={data.owner_info ?? '—'} />
          <KvRow label="Guest Password" value={data.guest_password ?? '—'} />
        </div>
      )}
    </RepeaterPane>
  );
}
