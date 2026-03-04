import { useState, useEffect } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import type {
  AppSettings,
  AppSettingsUpdate,
  HealthStatus,
  RadioConfig,
  RadioConfigUpdate,
} from '../../types';

export function SettingsIdentitySection({
  config,
  health,
  appSettings,
  pageMode,
  onSave,
  onSaveAppSettings,
  onSetPrivateKey,
  onReboot,
  onAdvertise,
  onClose,
  className,
}: {
  config: RadioConfig;
  health: HealthStatus | null;
  appSettings: AppSettings;
  pageMode: boolean;
  onSave: (update: RadioConfigUpdate) => Promise<void>;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  onSetPrivateKey: (key: string) => Promise<void>;
  onReboot: () => Promise<void>;
  onAdvertise: () => Promise<void>;
  onClose: () => void;
  className?: string;
}) {
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [advertIntervalHours, setAdvertIntervalHours] = useState('0');
  const [busy, setBusy] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(config.name);
  }, [config]);

  useEffect(() => {
    setAdvertIntervalHours(String(Math.round(appSettings.advert_interval / 3600)));
  }, [appSettings]);

  const handleSaveIdentity = async () => {
    setError(null);
    setBusy(true);

    try {
      const update: RadioConfigUpdate = { name };
      await onSave(update);

      const hours = parseInt(advertIntervalHours, 10);
      const newAdvertInterval = isNaN(hours) ? 0 : hours * 3600;
      if (newAdvertInterval !== appSettings.advert_interval) {
        await onSaveAppSettings({ advert_interval: newAdvertInterval });
      }

      toast.success('Identity settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const handleSetPrivateKey = async () => {
    if (!privateKey.trim()) {
      setError('Private key is required');
      return;
    }
    setError(null);
    setBusy(true);

    try {
      await onSetPrivateKey(privateKey.trim());
      setPrivateKey('');
      toast.success('Private key set, rebooting...');
      setRebooting(true);
      await onReboot();
      if (!pageMode) {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set private key');
    } finally {
      setRebooting(false);
      setBusy(false);
    }
  };

  const handleAdvertise = async () => {
    setAdvertising(true);
    try {
      await onAdvertise();
    } finally {
      setAdvertising(false);
    }
  };

  return (
    <div className={className}>
      <div className="space-y-2">
        <Label htmlFor="public-key">Public Key</Label>
        <Input id="public-key" value={config.public_key} disabled className="font-mono text-xs" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Radio Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="advert-interval">Periodic Advertising Interval</Label>
        <div className="flex items-center gap-2">
          <Input
            id="advert-interval"
            type="number"
            min="0"
            value={advertIntervalHours}
            onChange={(e) => setAdvertIntervalHours(e.target.value)}
            className="w-28"
          />
          <span className="text-sm text-muted-foreground">hours (0 = off)</span>
        </div>
        <p className="text-xs text-muted-foreground">
          How often to automatically advertise presence. Set to 0 to disable. Minimum: 1 hour.
          Recommended: 24 hours or higher.
        </p>
      </div>

      <Button onClick={handleSaveIdentity} disabled={busy} className="w-full">
        {busy ? 'Saving...' : 'Save Identity Settings'}
      </Button>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="private-key">Set Private Key (write-only)</Label>
        <Input
          id="private-key"
          type="password"
          autoComplete="off"
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder="64-character hex private key"
        />
        <Button
          onClick={handleSetPrivateKey}
          disabled={busy || rebooting || !privateKey.trim()}
          className="w-full"
        >
          {busy || rebooting ? 'Setting & Rebooting...' : 'Set Private Key & Reboot'}
        </Button>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Send Advertisement</Label>
        <p className="text-xs text-muted-foreground">
          Send a flood advertisement to announce your presence on the mesh network.
        </p>
        <Button
          onClick={handleAdvertise}
          disabled={advertising || !health?.radio_connected}
          className="w-full bg-warning hover:bg-warning/90 text-warning-foreground"
        >
          {advertising ? 'Sending...' : 'Send Advertisement'}
        </Button>
        {!health?.radio_connected && (
          <p className="text-sm text-destructive">Radio not connected</p>
        )}
      </div>

      {error && (
        <div className="text-sm text-destructive" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
