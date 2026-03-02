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
  'database',
  'bot',
  'mqtt',
  'statistics',
  'about',
];

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  radio: '📻 Radio',
  identity: '🪪 Identity',
  connectivity: '📡 Connectivity',
  database: '🗄️ Database & Interface',
  bot: '🤖 Bots',
  mqtt: '📤 MQTT',
  statistics: '📊 Statistics',
  about: 'About',
};
