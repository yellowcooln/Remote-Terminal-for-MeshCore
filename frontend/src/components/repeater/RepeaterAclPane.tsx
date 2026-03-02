import { cn } from '@/lib/utils';
import { RepeaterPane, NotFetched } from './repeaterPaneShared';
import type { RepeaterAclResponse, PaneState } from '../../types';

export function AclPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: RepeaterAclResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const permColor: Record<number, string> = {
    0: 'bg-muted text-muted-foreground',
    1: 'bg-blue-500/10 text-blue-500',
    2: 'bg-green-500/10 text-green-500',
    3: 'bg-amber-500/10 text-amber-500',
  };

  return (
    <RepeaterPane title="ACL" state={state} onRefresh={onRefresh} disabled={disabled}>
      {!data ? (
        <NotFetched />
      ) : data.acl.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ACL entries</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground text-xs">
              <th className="pb-1 font-medium">Name</th>
              <th className="pb-1 font-medium text-right">Permission</th>
            </tr>
          </thead>
          <tbody>
            {data.acl.map((entry, i) => (
              <tr key={i} className="border-t border-border/50">
                <td className="py-1">{entry.name || entry.pubkey_prefix}</td>
                <td className="py-1 text-right">
                  <span
                    className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      permColor[entry.permission] ?? 'bg-muted text-muted-foreground'
                    )}
                  >
                    {entry.permission_name}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </RepeaterPane>
  );
}
