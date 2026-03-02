import { useState, useEffect } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import type { AppSettings, AppSettingsUpdate, HealthStatus } from '../../types';

export function SettingsMqttSection({
  appSettings,
  health,
  onSaveAppSettings,
  className,
}: {
  appSettings: AppSettings;
  health: HealthStatus | null;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  className?: string;
}) {
  const [mqttBrokerHost, setMqttBrokerHost] = useState('');
  const [mqttBrokerPort, setMqttBrokerPort] = useState('1883');
  const [mqttUsername, setMqttUsername] = useState('');
  const [mqttPassword, setMqttPassword] = useState('');
  const [mqttUseTls, setMqttUseTls] = useState(false);
  const [mqttTlsInsecure, setMqttTlsInsecure] = useState(false);
  const [mqttTopicPrefix, setMqttTopicPrefix] = useState('meshcore');
  const [mqttPublishMessages, setMqttPublishMessages] = useState(false);
  const [mqttPublishRawPackets, setMqttPublishRawPackets] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMqttBrokerHost(appSettings.mqtt_broker_host ?? '');
    setMqttBrokerPort(String(appSettings.mqtt_broker_port ?? 1883));
    setMqttUsername(appSettings.mqtt_username ?? '');
    setMqttPassword(appSettings.mqtt_password ?? '');
    setMqttUseTls(appSettings.mqtt_use_tls ?? false);
    setMqttTlsInsecure(appSettings.mqtt_tls_insecure ?? false);
    setMqttTopicPrefix(appSettings.mqtt_topic_prefix ?? 'meshcore');
    setMqttPublishMessages(appSettings.mqtt_publish_messages ?? false);
    setMqttPublishRawPackets(appSettings.mqtt_publish_raw_packets ?? false);
  }, [appSettings]);

  const handleSave = async () => {
    setError(null);
    setBusy(true);

    try {
      const update: AppSettingsUpdate = {
        mqtt_broker_host: mqttBrokerHost,
        mqtt_broker_port: parseInt(mqttBrokerPort, 10) || 1883,
        mqtt_username: mqttUsername,
        mqtt_password: mqttPassword,
        mqtt_use_tls: mqttUseTls,
        mqtt_tls_insecure: mqttTlsInsecure,
        mqtt_topic_prefix: mqttTopicPrefix || 'meshcore',
        mqtt_publish_messages: mqttPublishMessages,
        mqtt_publish_raw_packets: mqttPublishRawPackets,
      };
      await onSaveAppSettings(update);
      toast.success('MQTT settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="space-y-2">
        <Label>Status</Label>
        {health?.mqtt_status === 'connected' ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-green-400">Connected</span>
          </div>
        ) : health?.mqtt_status === 'disconnected' ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-sm text-red-400">Disconnected</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gray-500" />
            <span className="text-sm text-muted-foreground">Disabled</span>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="mqtt-host">Broker Host</Label>
        <Input
          id="mqtt-host"
          type="text"
          placeholder="e.g. 192.168.1.100"
          value={mqttBrokerHost}
          onChange={(e) => setMqttBrokerHost(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mqtt-port">Broker Port</Label>
        <Input
          id="mqtt-port"
          type="number"
          min="1"
          max="65535"
          value={mqttBrokerPort}
          onChange={(e) => setMqttBrokerPort(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mqtt-username">Username</Label>
        <Input
          id="mqtt-username"
          type="text"
          placeholder="Optional"
          value={mqttUsername}
          onChange={(e) => setMqttUsername(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mqtt-password">Password</Label>
        <Input
          id="mqtt-password"
          type="password"
          placeholder="Optional"
          value={mqttPassword}
          onChange={(e) => setMqttPassword(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={mqttUseTls}
          onChange={(e) => setMqttUseTls(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">Use TLS</span>
      </label>

      {mqttUseTls && (
        <>
          <label className="flex items-center gap-3 cursor-pointer ml-7">
            <input
              type="checkbox"
              checked={mqttTlsInsecure}
              onChange={(e) => setMqttTlsInsecure(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm">Skip certificate verification</span>
          </label>
          <p className="text-xs text-muted-foreground ml-7">
            Allow self-signed or untrusted broker certificates
          </p>
        </>
      )}

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="mqtt-prefix">Topic Prefix</Label>
        <Input
          id="mqtt-prefix"
          type="text"
          value={mqttTopicPrefix}
          onChange={(e) => setMqttTopicPrefix(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Topics: {mqttTopicPrefix || 'meshcore'}/dm:&lt;key&gt;, {mqttTopicPrefix || 'meshcore'}
          /gm:&lt;key&gt;, {mqttTopicPrefix || 'meshcore'}
          /raw/...
        </p>
      </div>

      <Separator />

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={mqttPublishMessages}
          onChange={(e) => setMqttPublishMessages(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">Publish Messages</span>
      </label>
      <p className="text-xs text-muted-foreground ml-7">
        Forward decrypted DM and channel messages
      </p>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={mqttPublishRawPackets}
          onChange={(e) => setMqttPublishRawPackets(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">Publish Raw Packets</span>
      </label>
      <p className="text-xs text-muted-foreground ml-7">Forward all RF packets</p>

      <Button onClick={handleSave} disabled={busy} className="w-full">
        {busy ? 'Saving...' : 'Save MQTT Settings'}
      </Button>

      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
