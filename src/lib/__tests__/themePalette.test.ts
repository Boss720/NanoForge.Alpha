// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  THEME_PRESETS,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  CSS_VARIABLE_MAP,
  getThemePreset,
  generateThemePalette,
  resolveTheme,
  applyThemeVariables,
  saveTheme,
  loadSavedThemeConfig,
  activateTheme,
  initThemePalette,
  resetThemePalette,
  type ThemeConfig,
} from "../themePalette";

describe("themePalette engine", () => {
  beforeEach(() => {
    localStorage.clear();
    // Clean up documentElement inline styles
    for (const cssVar of Object.values(CSS_VARIABLE_MAP)) {
      document.documentElement.style.removeProperty(cssVar);
    }
  });

  afterEach(() => {
    localStorage.clear();
    for (const cssVar of Object.values(CSS_VARIABLE_MAP)) {
      document.documentElement.style.removeProperty(cssVar);
    }
  });

  describe("7 Calibrated Presets", () => {
    it("defines exactly 7 calibrated theme presets", () => {
      expect(THEME_PRESETS).toHaveLength(7);
    });

    it("contains all required preset IDs", () => {
      const expectedIds = [
        "ember-forge",
        "cyberpunk-neon",
        "emerald-matrix",
        "amethyst-velvet",
        "solar-flare",
        "midnight-slate",
        "monochrome-obsidian",
      ];
      const actualIds = THEME_PRESETS.map((p) => p.id);
      expect(actualIds).toEqual(expectedIds);
    });

    it("has complete token variables for all 7 presets", () => {
      for (const preset of THEME_PRESETS) {
        expect(preset.name).toBeTruthy();
        expect(preset.description).toBeTruthy();
        expect(preset.previewColors.primary).toBeTruthy();
        expect(preset.previewColors.background).toBeTruthy();
        expect(preset.previewColors.card).toBeTruthy();
        expect(preset.previewColors.accent).toBeTruthy();

        // Check every CSS variable is defined in preset.variables
        for (const key of Object.keys(CSS_VARIABLE_MAP)) {
          const val = preset.variables[key as keyof typeof preset.variables];
          expect(val).toBeDefined();
          expect(typeof val).toBe("string");
          expect(val.length).toBeGreaterThan(0);
        }
      }
    });

    it("has Ember Forge as the default preset with ember amber hues", () => {
      const defaultPreset = THEME_PRESETS[0];
      expect(defaultPreset.id).toBe(DEFAULT_THEME_ID);
      expect(defaultPreset.name).toBe("Ember Forge");
      expect(defaultPreset.variables.primary).toContain("32 100% 55%");
    });

    it("has Cyberpunk Neon with electric cyan primary", () => {
      const preset = getThemePreset("cyberpunk-neon");
      expect(preset).not.toBeNull();
      expect(preset?.variables.primary).toContain("185 100% 50%");
    });

    it("has Emerald Matrix with phosphorescent matrix green", () => {
      const preset = getThemePreset("emerald-matrix");
      expect(preset).not.toBeNull();
      expect(preset?.variables.primary).toContain("155 100% 45%");
    });

    it("has Amethyst Velvet with electric violet", () => {
      const preset = getThemePreset("amethyst-velvet");
      expect(preset).not.toBeNull();
      expect(preset?.variables.primary).toContain("270 85% 65%");
    });

    it("has Solar Flare with radiant gold", () => {
      const preset = getThemePreset("solar-flare");
      expect(preset).not.toBeNull();
      expect(preset?.variables.primary).toContain("45 100% 50%");
    });

    it("has Midnight Slate with steel sky blue", () => {
      const preset = getThemePreset("midnight-slate");
      expect(preset).not.toBeNull();
      expect(preset?.variables.primary).toContain("210 100% 56%");
    });

    it("has Monochrome Obsidian with pure OLED black and platinum white", () => {
      const preset = getThemePreset("monochrome-obsidian");
      expect(preset).not.toBeNull();
      expect(preset?.variables.background).toContain("0 0% 2%");
      expect(preset?.variables.primary).toContain("0 0% 95%");
    });
  });

  describe("getThemePreset", () => {
    it("returns preset by valid ID", () => {
      const p = getThemePreset("solar-flare");
      expect(p?.name).toBe("Solar Flare");
    });

    it("returns null for non-existent ID", () => {
      expect(getThemePreset("unknown-theme-xyz")).toBeNull();
    });
  });

  describe("generateThemePalette", () => {
    it("generates custom theme variables from config with specific hue, sat, light", () => {
      const config: ThemeConfig = {
        primaryHue: 200,
        primarySaturation: 80,
        primaryLightness: 60,
        accentHue: 340,
        surfaceContrast: "deep",
        radius: "default",
      };
      const vars = generateThemePalette(config);
      expect(vars.primary).toBe("200 80% 60%");
      expect(vars.radius).toBe("0.5rem");
      expect(vars.accent).toContain("340");
      expect(vars.background).toContain("200");
    });

    it("handles different surface contrast modes properly", () => {
      const oled = generateThemePalette({
        primaryHue: 120,
        primarySaturation: 90,
        primaryLightness: 50,
        surfaceContrast: "oled",
        radius: "none",
      });
      expect(oled.background).toContain("2%");
      expect(oled.radius).toBe("0rem");

      const soft = generateThemePalette({
        primaryHue: 120,
        primarySaturation: 90,
        primaryLightness: 50,
        surfaceContrast: "soft",
        radius: "rounded",
      });
      expect(soft.background).toContain("8%");
      expect(soft.radius).toBe("0.75rem");

      const lifted = generateThemePalette({
        primaryHue: 120,
        primarySaturation: 90,
        primaryLightness: 50,
        surfaceContrast: "lifted",
        radius: "pill",
      });
      expect(lifted.background).toContain("12%");
      expect(lifted.radius).toBe("1rem");

      const numericContrast = generateThemePalette({
        primaryHue: 120,
        primarySaturation: 90,
        primaryLightness: 50,
        surfaceContrast: 15,
        radius: "compact",
      });
      expect(numericContrast.background).toContain("15%");
      expect(numericContrast.radius).toBe("0.25rem");
    });

    it("adjusts primary foreground contrast for dark vs light primary colors", () => {
      const lightPrimary = generateThemePalette({
        primaryHue: 60,
        primarySaturation: 100,
        primaryLightness: 80,
        surfaceContrast: "deep",
        radius: "default",
      });
      // Light primary should have dark foreground text
      expect(lightPrimary.primaryForeground).toContain("5%");

      const darkPrimary = generateThemePalette({
        primaryHue: 240,
        primarySaturation: 90,
        primaryLightness: 30,
        surfaceContrast: "deep",
        radius: "default",
      });
      // Dark primary should have bright foreground text
      expect(darkPrimary.primaryForeground).toContain("95%");
    });
  });

  describe("resolveTheme", () => {
    it("resolves string ID for existing preset", () => {
      const res = resolveTheme("amethyst-velvet");
      expect(res.preset?.id).toBe("amethyst-velvet");
      expect(res.variables.primary).toContain("270 85% 65%");
    });

    it("falls back to default preset for unknown string ID", () => {
      const res = resolveTheme("non-existent");
      expect(res.preset?.id).toBe(DEFAULT_THEME_ID);
    });

    it("resolves full ThemePreset object", () => {
      const preset = THEME_PRESETS[1];
      const res = resolveTheme(preset);
      expect(res.preset?.id).toBe(preset.id);
      expect(res.variables).toEqual(preset.variables);
    });

    it("resolves custom ThemeConfig and marks isCustom", () => {
      const customConfig: ThemeConfig = {
        primaryHue: 280,
        primarySaturation: 90,
        primaryLightness: 50,
        surfaceContrast: "oled",
        radius: "pill",
      };
      const res = resolveTheme(customConfig);
      expect(res.preset).toBeNull();
      expect(res.config.isCustom).toBe(true);
      expect(res.variables.primary).toBe("280 90% 50%");
    });
  });

  describe("applyThemeVariables", () => {
    it("mutates document.documentElement CSS properties without page reload", () => {
      const preset = THEME_PRESETS[1]; // Cyberpunk Neon
      applyThemeVariables(preset.variables);

      expect(document.documentElement.style.getPropertyValue("--primary")).toBe(preset.variables.primary);
      expect(document.documentElement.style.getPropertyValue("--background")).toBe(preset.variables.background);
      expect(document.documentElement.style.getPropertyValue("--card")).toBe(preset.variables.card);
      expect(document.documentElement.style.getPropertyValue("--border")).toBe(preset.variables.border);
      expect(document.documentElement.style.getPropertyValue("--radius")).toBe(preset.variables.radius);
    });
  });

  describe("Persistence & Hydration", () => {
    it("saves and loads theme configuration to and from localStorage", () => {
      const config: ThemeConfig = {
        id: "emerald-matrix",
        name: "Emerald Matrix",
        primaryHue: 155,
        primarySaturation: 100,
        primaryLightness: 45,
        surfaceContrast: "deep",
        radius: "compact",
      };

      saveTheme(config);
      const loaded = loadSavedThemeConfig();
      expect(loaded).toEqual(config);
    });

    it("handles corrupted JSON in localStorage gracefully without throwing", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "invalid-json-{");
      const loaded = loadSavedThemeConfig();
      expect(loaded).toBeNull();
    });

    it("activates theme and persists to localStorage and documentElement simultaneously", () => {
      const result = activateTheme("solar-flare");
      expect(result.preset?.id).toBe("solar-flare");
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe("45 100% 50%");

      const saved = loadSavedThemeConfig();
      expect(saved?.id).toBe("solar-flare");
    });

    it("hydrates saved theme on initThemePalette boot", () => {
      const customConfig: ThemeConfig = {
        primaryHue: 190,
        primarySaturation: 95,
        primaryLightness: 48,
        surfaceContrast: "soft",
        radius: "rounded",
        isCustom: true,
      };
      saveTheme(customConfig);

      const hydrated = initThemePalette();
      expect(hydrated.config.primaryHue).toBe(190);
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe("190 95% 48%");
      expect(document.documentElement.style.getPropertyValue("--radius")).toBe("0.75rem");
    });

    it("hydrates default Ember Forge preset on initThemePalette when storage is empty", () => {
      const hydrated = initThemePalette();
      expect(hydrated.preset?.id).toBe(DEFAULT_THEME_ID);
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe("32 100% 55%");
    });

    it("resets to Ember Forge on resetThemePalette", () => {
      activateTheme("cyberpunk-neon");
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe("185 100% 50%");

      const resetRes = resetThemePalette();
      expect(resetRes.preset.id).toBe(DEFAULT_THEME_ID);
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe("32 100% 55%");
    });
  });
});
