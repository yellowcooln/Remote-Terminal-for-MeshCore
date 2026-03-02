import { useState, useEffect } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import type { AppSettings, AppSettingsUpdate, HealthStatus } from '../../types';

export function SettingsConnectivitySection({
  appSettings,
  health,
  pageMode,
  onSaveAppSettings,
  onReboot,
  onClose,
  className,
}: {
  appSettings: AppSettings;
  health: HealthStatus | null;
  pageMode: boolean;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  onReboot: () => Promise<void>;
  onClose: () => void;
  className?: string;
}) {
  const [maxRadioContacts, setMaxRadioContacts] = useState('');
  const [busy, setBusy] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMaxRadioContacts(String(appSettings.max_radio_contacts));
  }, [appSettings]);

  const handleSave = async () => {
    setError(null);
    setBusy(true);

    try {
      const update: AppSettingsUpdate = {};
      const newMaxRadioContacts = parseInt(maxRadioContacts, 10);
      if (!isNaN(newMaxRadioContacts) && newMaxRadioContacts !== appSettings.max_radio_contacts) {
        update.max_radio_contacts = newMaxRadioContacts;
      }
      if (Object.keys(update).length > 0) {
        await onSaveAppSettings(update);
      }
      toast.success('Connectivity settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const handleReboot = async () => {
    if (
      !confirm('Are you sure you want to reboot the radio? The connection will drop temporarily.')
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    setRebooting(true);

    try {
      await onReboot();
      if (!pageMode) {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reboot radio');
    } finally {
      setRebooting(false);
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="space-y-2">
        <Label>Connection</Label>
        {health?.connection_info ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <code className="px-2 py-1 bg-muted rounded text-foreground text-sm">
              {health.connection_info}
            </code>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-gray-500" />
            <span>Not connected</span>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="max-contacts">Max Contacts on Radio</Label>
        <Input
          id="max-contacts"
          type="number"
          min="1"
          max="1000"
          value={maxRadioContacts}
          onChange={(e) => setMaxRadioContacts(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Favorite contacts load first, then recent non-repeater contacts until this limit is
          reached (1-1000)
        </p>
      </div>

      <Button onClick={handleSave} disabled={busy} className="w-full">
        {busy ? 'Saving...' : 'Save Settings'}
      </Button>

      <Separator />

      <Button
        variant="outline"
        onClick={handleReboot}
        disabled={rebooting || busy}
        className="w-full border-red-500/50 text-red-400 hover:bg-red-500/10"
      >
        {rebooting ? 'Rebooting...' : 'Reboot Radio'}
      </Button>

      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
