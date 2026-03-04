export interface Theme {
  id: string;
  name: string;
  /** 6 hex colors for the swatch preview: [bg, card, primary, accent, warm, cool] */
  swatches: [string, string, string, string, string, string];
  /** Hex background color for the PWA theme-color meta tag */
  metaThemeColor: string;
}

export const THEMES: Theme[] = [
  {
    id: 'original',
    name: 'Original',
    swatches: ['#111419', '#181b21', '#27a05c', '#282c33', '#f59e0b', '#3b82f6'],
    metaThemeColor: '#111419',
  },
  {
    id: 'light',
    name: 'Light',
    swatches: ['#F8F7F4', '#FFFFFF', '#1B7D4E', '#EDEBE7', '#D97706', '#3B82F6'],
    metaThemeColor: '#F8F7F4',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    swatches: ['#07080A', '#0D1112', '#00FF41', '#141E17', '#FAFF00', '#FF2E6C'],
    metaThemeColor: '#07080A',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    swatches: ['#0B0B14', '#131320', '#E8349A', '#1E1D30', '#E8A034', '#5B7FE8'],
    metaThemeColor: '#0B0B14',
  },
  {
    id: 'amber-terminal',
    name: 'Amber Terminal',
    swatches: ['#0A0906', '#12100B', '#FFAA00', '#1C1810', '#66BB22', '#E6451A'],
    metaThemeColor: '#0A0906',
  },
  {
    id: 'midnight-sun',
    name: 'Midnight Sun',
    swatches: ['#0E0C1A', '#181430', '#ECAA1A', '#22203C', '#2DA86C', '#D64040'],
    metaThemeColor: '#0E0C1A',
  },
  {
    id: 'basecamp',
    name: 'Basecamp',
    swatches: ['#1A1410', '#231D17', '#C4623A', '#2E2620', '#8B9A3C', '#5B8A8A'],
    metaThemeColor: '#1A1410',
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    swatches: ['#000000', '#141414', '#3B9EFF', '#1E1E1E', '#FFB800', '#FF4757'],
    metaThemeColor: '#000000',
  },
  {
    id: 'lo-fi',
    name: 'Lo-Fi',
    swatches: ['#161418', '#1E1C22', '#B4A0D4', '#262430', '#D4A08C', '#7CA09C'],
    metaThemeColor: '#161418',
  },
  {
    id: 'obsidian-glass',
    name: 'Obsidian Glass',
    swatches: ['#0C0E12', '#151821', '#D4A070', '#1E2230', '#D4924A', '#5B82B4'],
    metaThemeColor: '#0C0E12',
  },
];

const THEME_KEY = 'remoteterm-theme';

export function getSavedTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) ?? 'original';
  } catch {
    return 'original';
  }
}

export function applyTheme(themeId: string): void {
  try {
    localStorage.setItem(THEME_KEY, themeId);
  } catch {
    // localStorage may be unavailable
  }

  if (themeId === 'original') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = themeId;
  }

  // Update PWA theme-color meta tag
  const theme = THEMES.find((t) => t.id === themeId);
  if (theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme.metaThemeColor);
    }
  }
}
