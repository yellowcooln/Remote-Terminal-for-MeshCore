export type SettingsSection =
  | 'radio'
  | 'identity'
  | 'connectivity'
  | 'mqtt'
  | 'database'
  | 'bot'
  | 'statistics'
  | 'about';

export const SETTINGS_SECTION_ORDER: SettingsSection[] = [
  'radio',
  'identity',
  'connectivity',
  'mqtt',
  'database',
  'bot',
  'statistics',
  'about',
];

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  radio: '📻 Radio',
  identity: '🪪 Identity',
  connectivity: '📡 Connectivity',
  mqtt: '📤 MQTT',
  database: '🗄️ Database & Interface',
  bot: '🤖 Bot',
  statistics: '📊 Statistics',
  about: 'About',
};
