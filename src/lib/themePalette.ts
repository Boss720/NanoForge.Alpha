/**
 * NanoForge Dynamic UI Palette & Theme Customizer Engine
 * 
 * Provides:
 * - 7 calibrated theme presets (Ember Forge, Cyberpunk Neon, Emerald Matrix,
 *   Amethyst Velvet, Solar Flare, Midnight Slate, Monochrome Obsidian)
 * - Dynamic custom theme builder (hue, saturation, lightness, surface contrast, accent hue, radius)
 * - Zero-reload CSS custom properties applicator for document.documentElement
 * - Persistent storage in localStorage with boot hydration
 */

export interface ThemeVariables {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  radius: string;
  sidebarBackground: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
}

export type SurfaceContrastLevel = 'oled' | 'deep' | 'soft' | 'lifted';
export type RadiusPreset = 'none' | 'compact' | 'default' | 'rounded' | 'pill';

export interface ThemeConfig {
  id?: string;
  name?: string;
  isCustom?: boolean;
  primaryHue: number;
  primarySaturation: number;
  primaryLightness: number;
  accentHue?: number;
  surfaceContrast: SurfaceContrastLevel | number;
  radius: RadiusPreset | string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  previewColors: {
    primary: string;
    background: string;
    card: string;
    accent: string;
  };
  config: ThemeConfig;
  variables: ThemeVariables;
}

export const THEME_STORAGE_KEY = 'nanoforge.theme_palette';

export const RADIUS_VALUES: Record<RadiusPreset, string> = {
  none: '0rem',
  compact: '0.25rem',
  default: '0.5rem',
  rounded: '0.75rem',
  pill: '1rem',
};

export const SURFACE_CONTRAST_OPTIONS: { id: SurfaceContrastLevel; label: string; bgL: number }[] = [
  { id: 'oled', label: 'OLED Black (0%)', bgL: 2 },
  { id: 'deep', label: 'Deep Charcoal (4%)', bgL: 4 },
  { id: 'soft', label: 'Soft Slate (8%)', bgL: 8 },
  { id: 'lifted', label: 'Lifted Slate (12%)', bgL: 12 },
];

export const CSS_VARIABLE_MAP: Record<keyof ThemeVariables, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  radius: '--radius',
  sidebarBackground: '--sidebar-background',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarRing: '--sidebar-ring',
};

/**
 * 7 Calibrated Theme Presets
 */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'ember-forge',
    name: 'Ember Forge',
    description: 'Warm obsidian dark mode with glowing forge amber accents',
    previewColors: {
      primary: 'hsl(32, 100%, 55%)',
      background: 'hsl(30, 8%, 4%)',
      card: 'hsl(30, 9%, 6%)',
      accent: 'hsl(30, 8%, 13%)',
    },
    config: {
      id: 'ember-forge',
      name: 'Ember Forge',
      isCustom: false,
      primaryHue: 32,
      primarySaturation: 100,
      primaryLightness: 55,
      accentHue: 30,
      surfaceContrast: 'deep',
      radius: 'default',
    },
    variables: {
      background: '30 8% 4%',
      foreground: '36 12% 90%',
      card: '30 9% 6%',
      cardForeground: '36 12% 90%',
      popover: '30 10% 7%',
      popoverForeground: '36 12% 90%',
      primary: '32 100% 55%',
      primaryForeground: '30 10% 6%',
      secondary: '30 7% 12%',
      secondaryForeground: '36 12% 88%',
      muted: '30 6% 11%',
      mutedForeground: '32 6% 52%',
      accent: '30 8% 13%',
      accentForeground: '32 100% 60%',
      destructive: '4 74% 55%',
      destructiveForeground: '0 0% 98%',
      border: '32 8% 14%',
      input: '32 8% 16%',
      ring: '32 100% 55%',
      radius: '0.5rem',
      sidebarBackground: '30 9% 5%',
      sidebarForeground: '36 10% 84%',
      sidebarPrimary: '32 100% 55%',
      sidebarPrimaryForeground: '30 10% 6%',
      sidebarAccent: '30 7% 11%',
      sidebarAccentForeground: '36 12% 88%',
      sidebarBorder: '32 8% 12%',
      sidebarRing: '32 100% 55%',
    },
  },
  {
    id: 'cyberpunk-neon',
    name: 'Cyberpunk Neon',
    description: 'High-voltage electric cyan & neon highlights on void black',
    previewColors: {
      primary: 'hsl(185, 100%, 50%)',
      background: 'hsl(220, 15%, 4%)',
      card: 'hsl(220, 15%, 7%)',
      accent: 'hsl(300, 80%, 20%)',
    },
    config: {
      id: 'cyberpunk-neon',
      name: 'Cyberpunk Neon',
      isCustom: false,
      primaryHue: 185,
      primarySaturation: 100,
      primaryLightness: 50,
      accentHue: 300,
      surfaceContrast: 'deep',
      radius: 'compact',
    },
    variables: {
      background: '220 15% 4%',
      foreground: '210 20% 92%',
      card: '220 15% 7%',
      cardForeground: '210 20% 92%',
      popover: '220 15% 8%',
      popoverForeground: '210 20% 92%',
      primary: '185 100% 50%',
      primaryForeground: '220 15% 4%',
      secondary: '220 14% 13%',
      secondaryForeground: '210 20% 88%',
      muted: '220 12% 11%',
      mutedForeground: '200 15% 55%',
      accent: '300 80% 20%',
      accentForeground: '300 100% 70%',
      destructive: '348 90% 55%',
      destructiveForeground: '0 0% 98%',
      border: '190 40% 16%',
      input: '190 35% 18%',
      ring: '185 100% 50%',
      radius: '0.25rem',
      sidebarBackground: '220 16% 5%',
      sidebarForeground: '210 15% 84%',
      sidebarPrimary: '185 100% 50%',
      sidebarPrimaryForeground: '220 15% 4%',
      sidebarAccent: '220 14% 11%',
      sidebarAccentForeground: '210 20% 88%',
      sidebarBorder: '190 30% 14%',
      sidebarRing: '185 100% 50%',
    },
  },
  {
    id: 'emerald-matrix',
    name: 'Emerald Matrix',
    description: 'Terminal green & phosphorescent matrix phosphor',
    previewColors: {
      primary: 'hsl(155, 100%, 45%)',
      background: 'hsl(160, 12%, 4%)',
      card: 'hsl(160, 12%, 6%)',
      accent: 'hsl(155, 30%, 14%)',
    },
    config: {
      id: 'emerald-matrix',
      name: 'Emerald Matrix',
      isCustom: false,
      primaryHue: 155,
      primarySaturation: 100,
      primaryLightness: 45,
      accentHue: 155,
      surfaceContrast: 'deep',
      radius: 'compact',
    },
    variables: {
      background: '160 12% 4%',
      foreground: '150 15% 90%',
      card: '160 12% 6%',
      cardForeground: '150 15% 90%',
      popover: '160 12% 7%',
      popoverForeground: '150 15% 90%',
      primary: '155 100% 45%',
      primaryForeground: '160 12% 4%',
      secondary: '160 10% 12%',
      secondaryForeground: '150 15% 88%',
      muted: '160 9% 10%',
      mutedForeground: '155 10% 50%',
      accent: '155 30% 14%',
      accentForeground: '155 100% 60%',
      destructive: '0 72% 51%',
      destructiveForeground: '0 0% 98%',
      border: '155 25% 15%',
      input: '155 25% 17%',
      ring: '155 100% 45%',
      radius: '0.25rem',
      sidebarBackground: '160 14% 5%',
      sidebarForeground: '150 12% 84%',
      sidebarPrimary: '155 100% 45%',
      sidebarPrimaryForeground: '160 12% 4%',
      sidebarAccent: '160 10% 11%',
      sidebarAccentForeground: '150 15% 88%',
      sidebarBorder: '155 20% 13%',
      sidebarRing: '155 100% 45%',
    },
  },
  {
    id: 'amethyst-velvet',
    name: 'Amethyst Velvet',
    description: 'Deep royal violet & mystical velvet amethyst',
    previewColors: {
      primary: 'hsl(270, 85%, 65%)',
      background: 'hsl(265, 12%, 4%)',
      card: 'hsl(265, 12%, 7%)',
      accent: 'hsl(270, 30%, 15%)',
    },
    config: {
      id: 'amethyst-velvet',
      name: 'Amethyst Velvet',
      isCustom: false,
      primaryHue: 270,
      primarySaturation: 85,
      primaryLightness: 65,
      accentHue: 280,
      surfaceContrast: 'deep',
      radius: 'rounded',
    },
    variables: {
      background: '265 12% 4%',
      foreground: '270 15% 92%',
      card: '265 12% 7%',
      cardForeground: '270 15% 92%',
      popover: '265 12% 8%',
      popoverForeground: '270 15% 92%',
      primary: '270 85% 65%',
      primaryForeground: '265 12% 4%',
      secondary: '265 12% 13%',
      secondaryForeground: '270 15% 88%',
      muted: '265 10% 11%',
      mutedForeground: '270 10% 55%',
      accent: '270 30% 15%',
      accentForeground: '270 90% 75%',
      destructive: '350 75% 55%',
      destructiveForeground: '0 0% 98%',
      border: '270 25% 16%',
      input: '270 25% 18%',
      ring: '270 85% 65%',
      radius: '0.75rem',
      sidebarBackground: '265 14% 5%',
      sidebarForeground: '270 12% 84%',
      sidebarPrimary: '270 85% 65%',
      sidebarPrimaryForeground: '265 12% 4%',
      sidebarAccent: '265 12% 11%',
      sidebarAccentForeground: '270 15% 88%',
      sidebarBorder: '270 20% 14%',
      sidebarRing: '270 85% 65%',
    },
  },
  {
    id: 'solar-flare',
    name: 'Solar Flare',
    description: 'Radiant corona gold & burning solar flare orange',
    previewColors: {
      primary: 'hsl(45, 100%, 50%)',
      background: 'hsl(35, 12%, 4%)',
      card: 'hsl(35, 12%, 6%)',
      accent: 'hsl(35, 25%, 13%)',
    },
    config: {
      id: 'solar-flare',
      name: 'Solar Flare',
      isCustom: false,
      primaryHue: 45,
      primarySaturation: 100,
      primaryLightness: 50,
      accentHue: 25,
      surfaceContrast: 'deep',
      radius: 'default',
    },
    variables: {
      background: '35 12% 4%',
      foreground: '40 15% 90%',
      card: '35 12% 6%',
      cardForeground: '40 15% 90%',
      popover: '35 12% 7%',
      popoverForeground: '40 15% 90%',
      primary: '45 100% 50%',
      primaryForeground: '35 12% 4%',
      secondary: '35 10% 12%',
      secondaryForeground: '40 15% 88%',
      muted: '35 9% 10%',
      mutedForeground: '40 10% 52%',
      accent: '35 25% 13%',
      accentForeground: '45 100% 60%',
      destructive: '10 80% 52%',
      destructiveForeground: '0 0% 98%',
      border: '40 25% 15%',
      input: '40 25% 17%',
      ring: '45 100% 50%',
      radius: '0.5rem',
      sidebarBackground: '35 14% 5%',
      sidebarForeground: '40 12% 84%',
      sidebarPrimary: '45 100% 50%',
      sidebarPrimaryForeground: '35 12% 4%',
      sidebarAccent: '35 10% 11%',
      sidebarAccentForeground: '40 15% 88%',
      sidebarBorder: '40 20% 13%',
      sidebarRing: '45 100% 50%',
    },
  },
  {
    id: 'midnight-slate',
    name: 'Midnight Slate',
    description: 'Deep oceanic navy & steel cerulean sky',
    previewColors: {
      primary: 'hsl(210, 100%, 56%)',
      background: 'hsl(222, 15%, 5%)',
      card: 'hsl(222, 15%, 8%)',
      accent: 'hsl(215, 25%, 15%)',
    },
    config: {
      id: 'midnight-slate',
      name: 'Midnight Slate',
      isCustom: false,
      primaryHue: 210,
      primarySaturation: 100,
      primaryLightness: 56,
      accentHue: 210,
      surfaceContrast: 'deep',
      radius: 'default',
    },
    variables: {
      background: '222 15% 5%',
      foreground: '215 20% 92%',
      card: '222 15% 8%',
      cardForeground: '215 20% 92%',
      popover: '222 15% 9%',
      popoverForeground: '215 20% 92%',
      primary: '210 100% 56%',
      primaryForeground: '222 15% 5%',
      secondary: '220 14% 14%',
      secondaryForeground: '215 20% 88%',
      muted: '220 12% 12%',
      mutedForeground: '215 15% 55%',
      accent: '215 25% 15%',
      accentForeground: '210 100% 65%',
      destructive: '0 75% 55%',
      destructiveForeground: '0 0% 98%',
      border: '215 20% 16%',
      input: '215 20% 18%',
      ring: '210 100% 56%',
      radius: '0.5rem',
      sidebarBackground: '222 16% 6%',
      sidebarForeground: '215 15% 84%',
      sidebarPrimary: '210 100% 56%',
      sidebarPrimaryForeground: '222 15% 5%',
      sidebarAccent: '222 14% 12%',
      sidebarAccentForeground: '215 20% 88%',
      sidebarBorder: '215 18% 14%',
      sidebarRing: '210 100% 56%',
    },
  },
  {
    id: 'monochrome-obsidian',
    name: 'Monochrome Obsidian',
    description: 'Minimalist pure OLED black & platinum white',
    previewColors: {
      primary: 'hsl(0, 0%, 95%)',
      background: 'hsl(0, 0%, 2%)',
      card: 'hsl(0, 0%, 5%)',
      accent: 'hsl(0, 0%, 12%)',
    },
    config: {
      id: 'monochrome-obsidian',
      name: 'Monochrome Obsidian',
      isCustom: false,
      primaryHue: 0,
      primarySaturation: 0,
      primaryLightness: 95,
      accentHue: 0,
      surfaceContrast: 'oled',
      radius: 'compact',
    },
    variables: {
      background: '0 0% 2%',
      foreground: '0 0% 95%',
      card: '0 0% 5%',
      cardForeground: '0 0% 95%',
      popover: '0 0% 6%',
      popoverForeground: '0 0% 95%',
      primary: '0 0% 95%',
      primaryForeground: '0 0% 4%',
      secondary: '0 0% 11%',
      secondaryForeground: '0 0% 90%',
      muted: '0 0% 9%',
      mutedForeground: '0 0% 55%',
      accent: '0 0% 12%',
      accentForeground: '0 0% 95%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 98%',
      border: '0 0% 15%',
      input: '0 0% 17%',
      ring: '0 0% 90%',
      radius: '0.25rem',
      sidebarBackground: '0 0% 3%',
      sidebarForeground: '0 0% 85%',
      sidebarPrimary: '0 0% 95%',
      sidebarPrimaryForeground: '0 0% 4%',
      sidebarAccent: '0 0% 10%',
      sidebarAccentForeground: '0 0% 90%',
      sidebarBorder: '0 0% 13%',
      sidebarRing: '0 0% 90%',
    },
  },
];

export const DEFAULT_THEME_ID = 'ember-forge';

/**
 * Generates full CSS variable tokens from custom ThemeConfig parameters.
 */
export function generateThemePalette(config: ThemeConfig): ThemeVariables {
  const h = Math.round(config.primaryHue ?? 32);
  const s = Math.round(config.primarySaturation ?? 100);
  const l = Math.round(config.primaryLightness ?? 55);

  const accH = Math.round(config.accentHue ?? h);

  // Derive background lightness from surfaceContrast
  let bgL = 4;
  let bgSat = Math.max(0, Math.min(25, Math.round(s * 0.15)));

  if (typeof config.surfaceContrast === 'number') {
    bgL = Math.max(0, Math.min(25, config.surfaceContrast));
  } else if (config.surfaceContrast === 'oled') {
    bgL = 2;
    bgSat = Math.max(0, Math.min(10, Math.round(s * 0.08)));
  } else if (config.surfaceContrast === 'deep') {
    bgL = 4;
    bgSat = Math.max(0, Math.min(18, Math.round(s * 0.12)));
  } else if (config.surfaceContrast === 'soft') {
    bgL = 8;
    bgSat = Math.max(0, Math.min(22, Math.round(s * 0.15)));
  } else if (config.surfaceContrast === 'lifted') {
    bgL = 12;
    bgSat = Math.max(0, Math.min(25, Math.round(s * 0.18)));
  }

  const cardL = bgL + 2.5;
  const popoverL = bgL + 3.5;
  const secondaryL = bgL + 8;
  const mutedL = bgL + 6.5;
  const borderL = bgL + 10;
  const inputL = bgL + 12;
  const sidebarBgL = bgL + 1;
  const sidebarBorderL = bgL + 8;

  // Resolve radius
  let radius = '0.5rem';
  if (config.radius && config.radius in RADIUS_VALUES) {
    radius = RADIUS_VALUES[config.radius as RadiusPreset];
  } else if (typeof config.radius === 'string') {
    radius = config.radius;
  }

  // Primary foreground contrast: if primary is light, use dark text, else light
  const primaryFgL = l > 55 ? 5 : 95;
  const primaryFgSat = l > 55 ? 10 : 0;

  return {
    background: `${h} ${bgSat}% ${bgL}%`,
    foreground: `${h} 15% 91%`,
    card: `${h} ${bgSat + 1}% ${cardL}%`,
    cardForeground: `${h} 15% 91%`,
    popover: `${h} ${bgSat + 2}% ${popoverL}%`,
    popoverForeground: `${h} 15% 91%`,
    primary: `${h} ${s}% ${l}%`,
    primaryForeground: `${h} ${primaryFgSat}% ${primaryFgL}%`,
    secondary: `${h} ${Math.max(5, bgSat - 1)}% ${secondaryL}%`,
    secondaryForeground: `${h} 15% 88%`,
    muted: `${h} ${Math.max(4, bgSat - 2)}% ${mutedL}%`,
    mutedForeground: `${h} 10% 54%`,
    accent: `${accH} ${Math.min(50, s * 0.4)}% ${bgL + 9}%`,
    accentForeground: `${accH} ${s}% ${Math.min(95, l + 10)}%`,
    destructive: '4 74% 55%',
    destructiveForeground: '0 0% 98%',
    border: `${h} ${Math.max(6, bgSat)}% ${borderL}%`,
    input: `${h} ${Math.max(6, bgSat)}% ${inputL}%`,
    ring: `${h} ${s}% ${l}%`,
    radius,
    sidebarBackground: `${h} ${bgSat + 1}% ${sidebarBgL}%`,
    sidebarForeground: `${h} 12% 85%`,
    sidebarPrimary: `${h} ${s}% ${l}%`,
    sidebarPrimaryForeground: `${h} ${primaryFgSat}% ${primaryFgL}%`,
    sidebarAccent: `${h} ${Math.max(5, bgSat - 1)}% ${mutedL}%`,
    sidebarAccentForeground: `${h} 15% 88%`,
    sidebarBorder: `${h} ${Math.max(6, bgSat)}% ${sidebarBorderL}%`,
    sidebarRing: `${h} ${s}% ${l}%`,
  };
}

/**
 * Apply CSS custom properties to document.documentElement in real-time
 * without needing a page refresh.
 */
export function applyThemeVariables(variables: ThemeVariables): void {
  if (typeof document === 'undefined' || !document.documentElement) {
    return;
  }
  const rootStyle = document.documentElement.style;
  for (const [propKey, cssVar] of Object.entries(CSS_VARIABLE_MAP)) {
    const val = variables[propKey as keyof ThemeVariables];
    if (val !== undefined) {
      rootStyle.setProperty(cssVar, val);
    }
  }
}

/**
 * Saves the active theme config or preset to localStorage.
 */
export function saveTheme(theme: ThemePreset | ThemeConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const configToSave = 'config' in theme ? theme.config : theme;
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(configToSave));
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Loads the saved theme config from localStorage.
 */
export function loadSavedThemeConfig(): ThemeConfig | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ThemeConfig;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    /* ignore parse errors */
  }
  return null;
}

/**
 * Gets a preset by id or null if not found.
 */
export function getThemePreset(id: string): ThemePreset | null {
  return THEME_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Resolves a full ThemePreset or generated theme from a ThemeConfig or preset ID.
 */
export function resolveTheme(themeOrId: string | ThemeConfig | ThemePreset): {
  preset: ThemePreset | null;
  config: ThemeConfig;
  variables: ThemeVariables;
} {
  if (typeof themeOrId === 'string') {
    const preset = getThemePreset(themeOrId);
    if (preset) {
      return { preset, config: preset.config, variables: preset.variables };
    }
    const defaultPreset = THEME_PRESETS[0];
    return { preset: defaultPreset, config: defaultPreset.config, variables: defaultPreset.variables };
  }

  if ('variables' in themeOrId && 'previewColors' in themeOrId) {
    return { preset: themeOrId, config: themeOrId.config, variables: themeOrId.variables };
  }

  const config = themeOrId;
  if (config.id && !config.isCustom) {
    const preset = getThemePreset(config.id);
    if (preset) {
      return { preset, config: preset.config, variables: preset.variables };
    }
  }

  const variables = generateThemePalette(config);
  return { preset: null, config: { ...config, isCustom: true }, variables };
}

/**
 * Activates a theme: resolves its variables, applies them to the DOM, and saves to localStorage.
 */
export function activateTheme(themeOrId: string | ThemeConfig | ThemePreset): {
  preset: ThemePreset | null;
  config: ThemeConfig;
  variables: ThemeVariables;
} {
  const resolved = resolveTheme(themeOrId);
  applyThemeVariables(resolved.variables);
  saveTheme(resolved.config);
  return resolved;
}

/**
 * Hydrates theme on app boot.
 * Reads saved theme from localStorage, applies it immediately to the DOM,
 * and returns the active theme information.
 */
export function initThemePalette(): {
  preset: ThemePreset | null;
  config: ThemeConfig;
  variables: ThemeVariables;
} {
  const saved = loadSavedThemeConfig();
  if (saved) {
    return activateTheme(saved);
  }
  const defaultPreset = THEME_PRESETS[0];
  applyThemeVariables(defaultPreset.variables);
  return {
    preset: defaultPreset,
    config: defaultPreset.config,
    variables: defaultPreset.variables,
  };
}

/**
 * Resets the theme to the default Ember Forge preset.
 */
export function resetThemePalette(): {
  preset: ThemePreset;
  config: ThemeConfig;
  variables: ThemeVariables;
} {
  const defaultPreset = THEME_PRESETS[0];
  activateTheme(defaultPreset.id);
  return {
    preset: defaultPreset,
    config: defaultPreset.config,
    variables: defaultPreset.variables,
  };
}
