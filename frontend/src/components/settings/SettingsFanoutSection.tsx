import { useState, useEffect, useCallback } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import { cn } from '@/lib/utils';
import { api } from '../../api';
import type { FanoutConfig, HealthStatus } from '../../types';

const TYPE_LABELS: Record<string, string> = {
  mqtt_private: 'Private MQTT',
  mqtt_community: 'Community MQTT',
};

const TYPE_OPTIONS = [
  { value: 'mqtt_private', label: 'Private MQTT' },
  { value: 'mqtt_community', label: 'Community MQTT' },
];

function getStatusColor(status: string | undefined) {
  if (status === 'connected')
    return 'bg-status-connected shadow-[0_0_6px_hsl(var(--status-connected)/0.5)]';
  return 'bg-muted-foreground';
}

function getStatusLabel(status: string | undefined) {
  if (status === 'connected') return 'Connected';
  if (status === 'disconnected') return 'Disconnected';
  return 'Inactive';
}

function MqttPrivateConfigEditor({
  config,
  scope,
  onChange,
  onScopeChange,
}: {
  config: Record<string, unknown>;
  scope: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  onScopeChange: (scope: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Forward mesh data to your own MQTT broker for home automation, logging, or alerting.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-mqtt-host">Broker Host</Label>
          <Input
            id="fanout-mqtt-host"
            type="text"
            placeholder="e.g. 192.168.1.100"
            value={(config.broker_host as string) || ''}
            onChange={(e) => onChange({ ...config, broker_host: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-mqtt-port">Broker Port</Label>
          <Input
            id="fanout-mqtt-port"
            type="number"
            min="1"
            max="65535"
            value={(config.broker_port as number) || 1883}
            onChange={(e) =>
              onChange({ ...config, broker_port: parseInt(e.target.value, 10) || 1883 })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-mqtt-user">Username</Label>
          <Input
            id="fanout-mqtt-user"
            type="text"
            placeholder="Optional"
            value={(config.username as string) || ''}
            onChange={(e) => onChange({ ...config, username: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-mqtt-pass">Password</Label>
          <Input
            id="fanout-mqtt-pass"
            type="password"
            placeholder="Optional"
            value={(config.password as string) || ''}
            onChange={(e) => onChange({ ...config, password: e.target.value })}
          />
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={!!config.use_tls}
          onChange={(e) => onChange({ ...config, use_tls: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">Use TLS</span>
      </label>

      {!!config.use_tls && (
        <label className="flex items-center gap-3 cursor-pointer ml-7">
          <input
            type="checkbox"
            checked={!!config.tls_insecure}
            onChange={(e) => onChange({ ...config, tls_insecure: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm">Skip certificate verification</span>
        </label>
      )}

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="fanout-mqtt-prefix">Topic Prefix</Label>
        <Input
          id="fanout-mqtt-prefix"
          type="text"
          value={(config.topic_prefix as string) || 'meshcore'}
          onChange={(e) => onChange({ ...config, topic_prefix: e.target.value })}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Scope</Label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={scope.messages === 'all'}
            onChange={(e) =>
              onScopeChange({ ...scope, messages: e.target.checked ? 'all' : 'none' })
            }
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm">Forward decoded messages</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={scope.raw_packets === 'all'}
            onChange={(e) =>
              onScopeChange({ ...scope, raw_packets: e.target.checked ? 'all' : 'none' })
            }
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm">Forward raw packets</span>
        </label>
      </div>
    </div>
  );
}

function MqttCommunityConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Share raw packet data with the MeshCore community for coverage mapping and network analysis.
        Only raw RF packets are shared &mdash; never decrypted messages.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-comm-host">Broker Host</Label>
          <Input
            id="fanout-comm-host"
            type="text"
            placeholder="mqtt-us-v1.letsmesh.net"
            value={(config.broker_host as string) || 'mqtt-us-v1.letsmesh.net'}
            onChange={(e) => onChange({ ...config, broker_host: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-comm-port">Broker Port</Label>
          <Input
            id="fanout-comm-port"
            type="number"
            min="1"
            max="65535"
            value={(config.broker_port as number) || 443}
            onChange={(e) =>
              onChange({ ...config, broker_port: parseInt(e.target.value, 10) || 443 })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fanout-comm-iata">Region Code (IATA)</Label>
        <Input
          id="fanout-comm-iata"
          type="text"
          maxLength={3}
          placeholder="e.g. DEN, LAX, NYC"
          value={(config.iata as string) || ''}
          onChange={(e) => onChange({ ...config, iata: e.target.value.toUpperCase() })}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          Your nearest airport&apos;s IATA code (required)
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fanout-comm-email">Owner Email (optional)</Label>
        <Input
          id="fanout-comm-email"
          type="email"
          placeholder="you@example.com"
          value={(config.email as string) || ''}
          onChange={(e) => onChange({ ...config, email: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Used to claim your node on the community aggregator
        </p>
      </div>
    </div>
  );
}

export function SettingsFanoutSection({
  health,
  className,
}: {
  health: HealthStatus | null;
  className?: string;
}) {
  const [configs, setConfigs] = useState<FanoutConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<Record<string, unknown>>({});
  const [editScope, setEditScope] = useState<Record<string, unknown>>({});
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [addingType, setAddingType] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      const data = await api.getFanoutConfigs();
      setConfigs(data);
    } catch (err) {
      console.error('Failed to load fanout configs:', err);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleToggleEnabled = async (cfg: FanoutConfig) => {
    try {
      await api.updateFanoutConfig(cfg.id, { enabled: !cfg.enabled });
      await loadConfigs();
      toast.success(cfg.enabled ? 'Integration disabled' : 'Integration enabled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleEdit = (cfg: FanoutConfig) => {
    setEditingId(cfg.id);
    setEditConfig(cfg.config);
    setEditScope(cfg.scope);
    setEditName(cfg.name);
  };

  const handleSave = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await api.updateFanoutConfig(editingId, {
        name: editName,
        config: editConfig,
        scope: editScope,
      });
      await loadConfigs();
      setEditingId(null);
      toast.success('Integration saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    const cfg = configs.find((c) => c.id === id);
    if (!confirm(`Delete "${cfg?.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteFanoutConfig(id);
      if (editingId === id) setEditingId(null);
      await loadConfigs();
      toast.success('Integration deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleAddStart = (type: string) => {
    setAddingType(type);
  };

  const handleAddCreate = async (type: string) => {
    const defaults: Record<string, Record<string, unknown>> = {
      mqtt_private: {
        broker_host: '',
        broker_port: 1883,
        username: '',
        password: '',
        use_tls: false,
        tls_insecure: false,
        topic_prefix: 'meshcore',
      },
      mqtt_community: {
        broker_host: 'mqtt-us-v1.letsmesh.net',
        broker_port: 443,
        iata: '',
        email: '',
      },
    };
    const defaultScopes: Record<string, Record<string, unknown>> = {
      mqtt_private: { messages: 'all', raw_packets: 'all' },
      mqtt_community: { messages: 'none', raw_packets: 'all' },
    };

    try {
      const created = await api.createFanoutConfig({
        type,
        name: TYPE_LABELS[type] || type,
        config: defaults[type] || {},
        scope: defaultScopes[type] || {},
        enabled: false,
      });
      await loadConfigs();
      setAddingType(null);
      handleEdit(created);
      toast.success('Integration created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create');
    }
  };

  const editingConfig = editingId ? configs.find((c) => c.id === editingId) : null;

  // Detail view
  if (editingConfig) {
    return (
      <div className={cn('space-y-4', className)}>
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setEditingId(null)}
        >
          &larr; Back to list
        </button>

        <div className="space-y-2">
          <Label htmlFor="fanout-edit-name">Name</Label>
          <Input
            id="fanout-edit-name"
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
        </div>

        <div className="text-xs text-muted-foreground">
          Type: {TYPE_LABELS[editingConfig.type] || editingConfig.type}
        </div>

        <Separator />

        {editingConfig.type === 'mqtt_private' && (
          <MqttPrivateConfigEditor
            config={editConfig}
            scope={editScope}
            onChange={setEditConfig}
            onScopeChange={setEditScope}
          />
        )}

        {editingConfig.type === 'mqtt_community' && (
          <MqttCommunityConfigEditor config={editConfig} onChange={setEditConfig} />
        )}

        <Separator />

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={busy} className="flex-1">
            {busy ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="destructive" onClick={() => handleDelete(editingConfig.id)}>
            Delete
          </Button>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className={cn('space-y-4', className)}>
      <div className="rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-warning">
        MQTT support is an experimental feature in open beta. All publishing uses QoS 0
        (at-most-once delivery).
      </div>

      {configs.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-input rounded-md">
          <p className="text-muted-foreground mb-4">No integrations configured</p>
        </div>
      ) : (
        <div className="space-y-2">
          {configs.map((cfg) => {
            const statusEntry = health?.fanout_statuses?.[cfg.id];
            const status = cfg.enabled ? statusEntry?.status : undefined;
            return (
              <div key={cfg.id} className="border border-input rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
                  <label
                    className="flex items-center cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={() => handleToggleEnabled(cfg)}
                      className="w-4 h-4 rounded border-input accent-primary"
                      aria-label={`Enable ${cfg.name}`}
                    />
                  </label>

                  <span className="text-sm font-medium flex-1">{cfg.name}</span>

                  <span className="text-xs text-muted-foreground">
                    {TYPE_LABELS[cfg.type] || cfg.type}
                  </span>

                  <div
                    className={cn('w-2 h-2 rounded-full transition-colors', getStatusColor(status))}
                    title={getStatusLabel(status)}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {cfg.enabled ? getStatusLabel(status) : 'Disabled'}
                  </span>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleEdit(cfg)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addingType ? (
        <div className="border border-input rounded-md p-3 space-y-2">
          <Label>Select integration type:</Label>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={addingType === opt.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleAddCreate(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setAddingType(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => handleAddStart('mqtt_private')} className="w-full">
          + Add Integration
        </Button>
      )}
    </div>
  );
}
