import { useEffect, useState, useId } from "react";
import { Check, Palette, RotateCcw, Sparkles, Sliders, Layers, Box, X } from "lucide-react";
import {
  THEME_PRESETS,
  DEFAULT_THEME_ID,
  SURFACE_CONTRAST_OPTIONS,
  RADIUS_VALUES,
  type ThemeConfig,
  type RadiusPreset,
  activateTheme,
  resetThemePalette,
  loadSavedThemeConfig,
  generateThemePalette,
  applyThemeVariables,
  saveTheme,
} from "@/lib/themePalette";

const RADIUS_OPTIONS: { id: RadiusPreset; label: string; px: string }[] = [
  { id: "none", label: "Sharp", px: "0px" },
  { id: "compact", label: "Compact", px: "4px" },
  { id: "default", label: "Standard", px: "8px" },
  { id: "rounded", label: "Rounded", px: "12px" },
  { id: "pill", label: "Pill", px: "16px" },
];

interface ThemeCustomizerProps {
  onClose?: () => void;
  className?: string;
}

export function ThemeCustomizer({ onClose, className = "" }: ThemeCustomizerProps) {
  const customizerId = useId();
  const [activePresetId, setActivePresetId] = useState<string>(() => {
    const saved = loadSavedThemeConfig();
    return saved?.id && !saved.isCustom ? saved.id : DEFAULT_THEME_ID;
  });

  const [config, setConfig] = useState<ThemeConfig>(() => {
    const saved = loadSavedThemeConfig();
    if (saved) return saved;
    const defaultPreset = THEME_PRESETS[0];
    return defaultPreset.config;
  });

  // Re-sync on mount if needed
  useEffect(() => {
    const saved = loadSavedThemeConfig();
    if (saved) {
      setConfig(saved);
      if (saved.id && !saved.isCustom) {
        setActivePresetId(saved.id);
      } else {
        setActivePresetId("custom");
      }
    }
  }, []);

  // Handle choosing a preset
  const handleSelectPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePresetId(presetId);
    setConfig(preset.config);
    activateTheme(preset.id);
  };

  // Handle tuning custom parameters
  const handleUpdateConfig = (partial: Partial<ThemeConfig>) => {
    const updated: ThemeConfig = {
      ...config,
      ...partial,
      isCustom: true,
      id: "custom",
    };
    setActivePresetId("custom");
    setConfig(updated);
    const variables = generateThemePalette(updated);
    applyThemeVariables(variables);
    saveTheme(updated);
  };

  // Handle Reset to Default
  const handleReset = () => {
    const defaultTheme = resetThemePalette();
    setActivePresetId(DEFAULT_THEME_ID);
    setConfig(defaultTheme.config);
  };

  const primaryColorHsl = `hsl(${config.primaryHue}, ${config.primarySaturation}%, ${config.primaryLightness}%)`;
  const accentColorHsl = `hsl(${config.accentHue ?? config.primaryHue}, 80%, 55%)`;

  return (
    <div
      data-testid="theme-customizer"
      className={`flex flex-col space-y-6 rounded-lg bg-card text-card-foreground ${className}`}
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Palette className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-mono text-sm font-semibold tracking-wide text-foreground">
              Theme & Visual Palette
            </h2>
            <p className="text-xs text-muted-foreground">
              Calibrated presets & real-time HSL palette customizer
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="reset-theme-btn"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2.5 py-1.5 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to Default
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 7 Calibrated Preset Cards */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-1.5 font-mono text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Calibrated Presets</span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {THEME_PRESETS.map((preset) => {
            const isSelected = activePresetId === preset.id;
            return (
              <button
                type="button"
                key={preset.id}
                data-testid={`preset-card-${preset.id}`}
                onClick={() => handleSelectPreset(preset.id)}
                className={`group relative flex flex-col justify-between rounded-lg border p-3 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                    : "border-border bg-secondary/30 hover:border-border/80 hover:bg-secondary/60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {preset.name}
                    </span>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                      {preset.description}
                    </p>
                  </div>
                  {isSelected && (
                    <span
                      data-testid={`active-preset-check-${preset.id}`}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    >
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    </span>
                  )}
                </div>

                {/* Color Swatch Preview Dots */}
                <div className="mt-3 flex items-center gap-1.5">
                  <div
                    className="h-3.5 w-3.5 rounded-full border border-black/30 shadow-xs"
                    style={{ backgroundColor: preset.previewColors.primary }}
                    title="Primary"
                  />
                  <div
                    className="h-3.5 w-3.5 rounded-full border border-white/20 shadow-xs"
                    style={{ backgroundColor: preset.previewColors.background }}
                    title="Background"
                  />
                  <div
                    className="h-3.5 w-3.5 rounded-full border border-white/20 shadow-xs"
                    style={{ backgroundColor: preset.previewColors.card }}
                    title="Card Surface"
                  />
                  <div
                    className="h-3.5 w-3.5 rounded-full border border-black/30 shadow-xs"
                    style={{ backgroundColor: preset.previewColors.accent }}
                    title="Accent Highlight"
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Customization Sliders & Controls */}
      <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4">
        <div className="flex items-center gap-1.5 font-mono text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <Sliders className="h-3.5 w-3.5 text-primary" />
          <span>Real-Time Color Tuning</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Primary Hue Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor={`${customizerId}-primary-hue`} className="text-muted-foreground">Primary Hue</label>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-full border border-border"
                  style={{ backgroundColor: primaryColorHsl }}
                />
                <span className="font-semibold text-foreground">{config.primaryHue}°</span>
              </div>
            </div>
            <input
              id={`${customizerId}-primary-hue`}
              type="range"
              min="0"
              max="360"
              step="1"
              value={config.primaryHue}
              aria-label="Primary hue"
              data-testid="primary-hue-slider"
              onChange={(e) => handleUpdateConfig({ primaryHue: Number(e.target.value) })}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg accent-primary"
              style={{
                background:
                  "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
              }}
            />
          </div>

          {/* Accent Hue Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor={`${customizerId}-accent-hue`} className="text-muted-foreground">Accent Hue</label>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-full border border-border"
                  style={{ backgroundColor: accentColorHsl }}
                />
                <span className="font-semibold text-foreground">{config.accentHue ?? config.primaryHue}°</span>
              </div>
            </div>
            <input
              id={`${customizerId}-accent-hue`}
              type="range"
              min="0"
              max="360"
              step="1"
              value={config.accentHue ?? config.primaryHue}
              aria-label="Accent hue"
              data-testid="accent-hue-slider"
              onChange={(e) => handleUpdateConfig({ accentHue: Number(e.target.value) })}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg accent-primary"
              style={{
                background:
                  "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
              }}
            />
          </div>

          {/* Primary Saturation */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor={`${customizerId}-primary-saturation`} className="text-muted-foreground">Saturation</label>
              <span className="font-semibold text-foreground">{config.primarySaturation}%</span>
            </div>
            <input
              id={`${customizerId}-primary-saturation`}
              type="range"
              min="0"
              max="100"
              step="1"
              value={config.primarySaturation}
              aria-label="Primary saturation"
              data-testid="primary-saturation-slider"
              onChange={(e) => handleUpdateConfig({ primarySaturation: Number(e.target.value) })}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-secondary accent-primary"
            />
          </div>

          {/* Primary Lightness */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <label htmlFor={`${customizerId}-primary-lightness`} className="text-muted-foreground">Lightness</label>
              <span className="font-semibold text-foreground">{config.primaryLightness}%</span>
            </div>
            <input
              id={`${customizerId}-primary-lightness`}
              type="range"
              min="15"
              max="85"
              step="1"
              value={config.primaryLightness}
              aria-label="Primary lightness"
              data-testid="primary-lightness-slider"
              onChange={(e) => handleUpdateConfig({ primaryLightness: Number(e.target.value) })}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-secondary accent-primary"
            />
          </div>
        </div>

        {/* Surface Contrast Selector */}
        <div className="space-y-2 pt-2 border-t border-border/60">
          <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <span>Surface Contrast</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SURFACE_CONTRAST_OPTIONS.map((opt) => {
              const active = config.surfaceContrast === opt.id;
              return (
                <button
                  type="button"
                  key={opt.id}
                  data-testid={`contrast-btn-${opt.id}`}
                  onClick={() => handleUpdateConfig({ surfaceContrast: opt.id })}
                  className={`flex flex-col items-center justify-center rounded-md border p-2 text-center font-mono text-xs transition-all ${
                    active
                      ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                      : "border-border bg-secondary/40 text-muted-foreground hover:border-border/80 hover:text-foreground"
                  }`}
                >
                  <span>{opt.label.split(" ")[0]}</span>
                  <span className="text-[10px] opacity-75">{opt.label.split(" ")[1]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Border Radius Selector */}
        <div className="space-y-2 pt-2 border-t border-border/60">
          <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
            <Box className="h-3.5 w-3.5 text-primary" />
            <span>Border Radius</span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {RADIUS_OPTIONS.map((rad) => {
              const active =
                config.radius === rad.id ||
                config.radius === RADIUS_VALUES[rad.id] ||
                config.radius === rad.px;
              return (
                <button
                  type="button"
                  key={rad.id}
                  data-testid={`radius-btn-${rad.id}`}
                  onClick={() => handleUpdateConfig({ radius: rad.id })}
                  className={`flex flex-col items-center justify-center rounded-md border p-2 text-center font-mono text-xs transition-all ${
                    active
                      ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                      : "border-border bg-secondary/40 text-muted-foreground hover:border-border/80 hover:text-foreground"
                  }`}
                >
                  <span>{rad.label}</span>
                  <span className="text-[10px] opacity-75">{rad.px}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live Preview Swatch Box */}
      <div className="space-y-2.5">
        <span className="font-mono text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Live Component Preview
        </span>

        <div
          data-testid="live-preview-box"
          className="rounded-lg border border-border bg-background p-4 space-y-3.5 shadow-inner"
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 font-mono text-xs font-semibold text-primary-foreground shadow-xs transition-opacity hover:opacity-90"
            >
              Primary Action
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-secondary px-3 py-1.5 font-mono text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
            >
              Secondary
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              Outline
            </button>
            <button
              type="button"
              className="rounded-md bg-destructive px-3 py-1.5 font-mono text-xs font-semibold text-destructive-foreground hover:opacity-90"
            >
              Destructive
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 font-medium text-primary">
              Running
            </span>
            <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 font-medium text-secondary-foreground">
              Idle
            </span>
            <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 font-medium text-accent-foreground">
              Accent Badge
            </span>
          </div>

          <div className="rounded-md border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-card-foreground">
                Card Surface & Form Controls
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                Live Theme Swatch
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value="Sample theme input value..."
                className="w-full rounded-md border border-input bg-secondary/40 px-2.5 py-1 font-mono text-xs text-foreground outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
