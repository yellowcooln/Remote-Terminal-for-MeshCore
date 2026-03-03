import { useState, useEffect, lazy, Suspense } from 'react';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import { handleKeyboardActivate } from '../../utils/a11y';
import type { AppSettings, AppSettingsUpdate, BotConfig } from '../../types';

const BotCodeEditor = lazy(() =>
  import('../BotCodeEditor').then((m) => ({ default: m.BotCodeEditor }))
);

const DEFAULT_BOT_CODE = `def bot(
    sender_name: str | None,
    sender_key: str | None,
    message_text: str,
    is_dm: bool,
    channel_key: str | None,
    channel_name: str | None,
    sender_timestamp: int | None,
    path: str | None,
    is_outgoing: bool = False,
) -> str | list[str] | None:
    """
    Process messages and optionally return a reply.

    Args:
        sender_name: Display name of sender (may be None)
        sender_key: 64-char hex public key (None for channel msgs)
        message_text: The message content
        is_dm: True for direct messages, False for channel
        channel_key: 32-char hex key for channels, None for DMs
        channel_name: Channel name with hash (e.g. "#bot"), None for DMs
        sender_timestamp: Sender's timestamp (unix seconds, may be None)
        path: Hex-encoded routing path (may be None)
        is_outgoing: True if this is our own outgoing message

    Returns:
        None for no reply, a string for a single reply,
        or a list of strings to send multiple messages in order
    """
    # Don't reply to our own outgoing messages
    if is_outgoing:
        return None

    # Example: Only respond in #bot channel to "!pling" command
    if channel_name == "#bot" and "!pling" in message_text.lower():
        return "[BOT] Plong!"
    return None`;

export function SettingsBotSection({
  appSettings,
  isMobileLayout,
  onSaveAppSettings,
  className,
}: {
  appSettings: AppSettings;
  isMobileLayout: boolean;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  className?: string;
}) {
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [expandedBotId, setExpandedBotId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBots(appSettings.bots || []);
  }, [appSettings]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);

    try {
      await onSaveAppSettings({ bots });
      toast.success('Bot settings saved');
    } catch (err) {
      console.error('Failed to save bot settings:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to save';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setBusy(false);
    }
  };

  const handleAddBot = () => {
    const newBot: BotConfig = {
      id: crypto.randomUUID(),
      name: `Bot ${bots.length + 1}`,
      enabled: false,
      code: DEFAULT_BOT_CODE,
    };
    setBots([...bots, newBot]);
    setExpandedBotId(newBot.id);
  };

  const handleDeleteBot = (botId: string) => {
    const bot = bots.find((b) => b.id === botId);
    if (bot && bot.code.trim() && bot.code !== DEFAULT_BOT_CODE) {
      if (!confirm(`Delete "${bot.name}"? This will remove all its code.`)) {
        return;
      }
    }
    setBots(bots.filter((b) => b.id !== botId));
    if (expandedBotId === botId) {
      setExpandedBotId(null);
    }
  };

  const handleToggleBotEnabled = (botId: string) => {
    setBots(bots.map((b) => (b.id === botId ? { ...b, enabled: !b.enabled } : b)));
  };

  const handleBotCodeChange = (botId: string, code: string) => {
    setBots(bots.map((b) => (b.id === botId ? { ...b, code } : b)));
  };

  const handleStartEditingName = (bot: BotConfig) => {
    setEditingNameId(bot.id);
    setEditingNameValue(bot.name);
  };

  const handleFinishEditingName = () => {
    if (editingNameId && editingNameValue.trim()) {
      setBots(
        bots.map((b) => (b.id === editingNameId ? { ...b, name: editingNameValue.trim() } : b))
      );
    }
    setEditingNameId(null);
    setEditingNameValue('');
  };

  const handleResetBotCode = (botId: string) => {
    setBots(bots.map((b) => (b.id === botId ? { ...b, code: DEFAULT_BOT_CODE } : b)));
  };

  return (
    <div className={className}>
      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md">
        <p className="text-sm text-red-400">
          <strong>Experimental:</strong> This is an alpha feature and introduces automated message
          sending to your radio; unexpected behavior may occur. Use with caution, and please report
          any bugs!
        </p>
      </div>

      <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
        <p className="text-sm text-yellow-500">
          <strong>Security Warning:</strong> This feature executes arbitrary Python code on the
          server. Only run trusted code, and be cautious of arbitrary usage of message parameters.
        </p>
      </div>

      <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
        <p className="text-sm text-yellow-500">
          <strong>Don&apos;t wreck the mesh!</strong> Bots process ALL messages, including their
          own. Be careful of creating infinite loops!
        </p>
      </div>

      <div className="flex justify-between items-center">
        <Label>Bots</Label>
        <Button type="button" variant="outline" size="sm" onClick={handleAddBot}>
          + New Bot
        </Button>
      </div>

      {bots.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-input rounded-md">
          <p className="text-muted-foreground mb-4">No bots configured</p>
          <Button type="button" variant="outline" onClick={handleAddBot}>
            Create your first bot
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {bots.map((bot) => (
            <div key={bot.id} className="border border-input rounded-md overflow-hidden">
              <div
                className="flex items-center gap-2 px-3 py-2 bg-muted/50 cursor-pointer hover:bg-muted/80"
                role="button"
                tabIndex={0}
                aria-expanded={expandedBotId === bot.id}
                onKeyDown={handleKeyboardActivate}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('input, button')) return;
                  setExpandedBotId(expandedBotId === bot.id ? null : bot.id);
                }}
              >
                <span className="text-muted-foreground" aria-hidden="true">
                  {expandedBotId === bot.id ? '▼' : '▶'}
                </span>

                {editingNameId === bot.id ? (
                  <input
                    type="text"
                    value={editingNameValue}
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    onBlur={handleFinishEditingName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFinishEditingName();
                      if (e.key === 'Escape') {
                        setEditingNameId(null);
                        setEditingNameValue('');
                      }
                    }}
                    autoFocus
                    className="px-2 py-0.5 text-sm bg-background border border-input rounded flex-1 max-w-[200px]"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="text-sm font-medium flex-1 hover:text-primary cursor-text"
                    role="button"
                    tabIndex={0}
                    onKeyDown={handleKeyboardActivate}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEditingName(bot);
                    }}
                    title="Click to rename"
                  >
                    {bot.name}
                  </span>
                )}

                <label
                  className="flex items-center gap-1.5 cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={bot.enabled}
                    onChange={() => handleToggleBotEnabled(bot.id)}
                    className="w-4 h-4 rounded border-input accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">Enabled</span>
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteBot(bot.id);
                  }}
                  title="Delete bot"
                  aria-label="Delete bot"
                >
                  <span aria-hidden="true">🗑</span>
                </Button>
              </div>

              {expandedBotId === bot.id && (
                <div className="p-3 space-y-3 border-t border-input">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Define a <code className="bg-muted px-1 rounded">bot()</code> function that
                      receives message data and optionally returns a reply.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleResetBotCode(bot.id)}
                    >
                      Reset to Example
                    </Button>
                  </div>
                  <Suspense
                    fallback={
                      <div className="h-64 md:h-96 rounded-md border border-input bg-[#282c34] flex items-center justify-center text-muted-foreground">
                        Loading editor...
                      </div>
                    }
                  >
                    <BotCodeEditor
                      value={bot.code}
                      onChange={(code) => handleBotCodeChange(bot.id, code)}
                      id={`bot-code-${bot.id}`}
                      height={isMobileLayout ? '256px' : '384px'}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Separator />

      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          <strong>Available:</strong> Standard Python libraries and any modules installed in the
          server environment.
        </p>
        <p>
          <strong>Limits:</strong> 10 second timeout per bot.
        </p>
        <p>
          <strong>Note:</strong> Bots respond to all messages, including your own. For channel
          messages, <code>sender_key</code> is <code>None</code>. Multiple enabled bots run
          serially, with a two-second delay between messages to prevent repeater collision.
        </p>
      </div>

      {error && (
        <div className="text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      <Button onClick={handleSave} disabled={busy} className="w-full">
        {busy ? 'Saving...' : 'Save Bot Settings'}
      </Button>
    </div>
  );
}
