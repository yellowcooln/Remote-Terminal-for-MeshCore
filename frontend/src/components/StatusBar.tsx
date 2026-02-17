import { useState } from 'react';
import { Menu } from 'lucide-react';
import type { HealthStatus, RadioConfig } from '../types';
import { api } from '../api';
import { toast } from './ui/sonner';
import { cn } from '@/lib/utils';

interface StatusBarProps {
  health: HealthStatus | null;
  config: RadioConfig | null;
  settingsMode?: boolean;
  onSettingsClick: () => void;
  onMenuClick?: () => void;
}

export function StatusBar({
  health,
  config,
  settingsMode = false,
  onSettingsClick,
  onMenuClick,
}: StatusBarProps) {
  const connected = health?.radio_connected ?? false;
  const [reconnecting, setReconnecting] = useState(false);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const result = await api.reconnectRadio();
      if (result.connected) {
        toast.success('Reconnected', { description: result.message });
      }
    } catch (err) {
      toast.error('Reconnection failed', {
        description: err instanceof Error ? err.message : 'Check radio connection and power',
      });
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-card border-b border-border text-xs">
      {/* Mobile menu button - only visible on small screens */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="md:hidden p-1 bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      <h1 className="text-sm font-semibold tracking-tight mr-auto text-foreground">RemoteTerm</h1>

      <div className="flex items-center gap-1.5">
        <div
          className={cn(
            'w-2 h-2 rounded-full transition-colors',
            connected
              ? 'bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.5)]'
              : 'bg-muted-foreground'
          )}
        />
        <span className="hidden lg:inline text-muted-foreground">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {config && (
        <div className="hidden lg:flex items-center gap-2 text-muted-foreground">
          <span className="text-foreground font-medium">{config.name || 'Unnamed'}</span>
          <span
            className="font-mono text-[11px] text-muted-foreground cursor-pointer hover:text-primary transition-colors"
            onClick={() => {
              navigator.clipboard.writeText(config.public_key);
              toast.success('Public key copied!');
            }}
            title="Click to copy public key"
          >
            {config.public_key.toLowerCase()}
          </span>
        </div>
      )}

      {!connected && (
        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-md text-xs cursor-pointer hover:bg-amber-500/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {reconnecting ? 'Reconnecting...' : 'Reconnect'}
        </button>
      )}
      <button
        onClick={onSettingsClick}
        className="px-3 py-1.5 bg-secondary border border-border text-muted-foreground rounded-md text-xs cursor-pointer hover:bg-accent hover:text-foreground transition-colors"
      >
        {settingsMode ? 'Back to Chat' : 'Settings'}
      </button>
    </div>
  );
}
