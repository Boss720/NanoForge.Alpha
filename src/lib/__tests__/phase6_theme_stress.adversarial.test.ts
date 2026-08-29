/**
 * Phase 6 Dynamic Theme Customizer Adversarial Stress Test Suite
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  THEME_PRESETS,
  CSS_VARIABLE_MAP,
  generateThemePalette,
  resolveTheme,
  activateTheme,
  loadSavedThemeConfig,
  resetThemePalette,
  type ThemeConfig,
} from "../themePalette.js";

describe("Milestone 6 Challenger: Dynamic Theme Customizer Adversarial Checks", () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      clear: () => {
        store = {};
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
  })();

  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  describe("1. Preset Integrity & Variable Completeness", () => {
    it("verifies all 7 calibrated theme presets define every required CSS variable", () => {
      expect(THEME_PRESETS.length).toBe(7);

      const expectedPresets = [
        "ember-forge",
        "cyberpunk-neon",
        "emerald-matrix",
        "amethyst-velvet",
        "solar-flare",
        "midnight-slate",
        "monochrome-obsidian",
      ];

      const actualIds = THEME_PRESETS.map((p) => p.id);
      expect(actualIds).toEqual(expectedPresets);

      const requiredVars = Object.keys(CSS_VARIABLE_MAP);

      for (const preset of THEME_PRESETS) {
        expect(preset.name).toBeDefined();
        expect(preset.previewColors).toBeDefined();
        expect(preset.previewColors.primary).toMatch(/^hsl\(/);
        expect(preset.previewColors.background).toMatch(/^hsl\(/);

        for (const varKey of requiredVars) {
          const val = preset.variables[varKey as keyof typeof preset.variables];
          expect(val).toBeDefined();
          expect(typeof val).toBe("string");
          expect(val.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("2. HSL Generation & Extreme Input Boundaries", () => {
    it("handles extreme, negative, and wrapping hue values gracefully", () => {
      const hostileConfigs: ThemeConfig[] = [
        { primaryHue: -45, primarySaturation: 100, primaryLightness: 50, surfaceContrast: "deep", radius: "default" },
        { primaryHue: 750, primarySaturation: 120, primaryLightness: 110, surfaceContrast: "oled", radius: "compact" },
        { primaryHue: 0, primarySaturation: 0, primaryLightness: 0, surfaceContrast: "lifted", radius: "pill" },
        { primaryHue: 360, primarySaturation: 100, primaryLightness: 100, surfaceContrast: 15, radius: "none" },
      ];

      for (const cfg of hostileConfigs) {
        const vars = generateThemePalette(cfg);
        expect(vars.primary).toBeDefined();
        expect(vars.background).toBeDefined();
        expect(vars.foreground).toBeDefined();
        expect(vars.card).toBeDefined();
        expect(vars.accent).toBeDefined();
        expect(vars.border).toBeDefined();
      }
    });

    it("dynamically adjusts primary foreground contrast for light vs dark primary colors", () => {
      // Light primary (L = 80 > 55) -> primaryForeground must be dark (L = 5)
      const lightTheme = generateThemePalette({
        primaryHue: 45,
        primarySaturation: 100,
        primaryLightness: 80,
        surfaceContrast: "deep",
        radius: "default",
      });
      expect(lightTheme.primaryForeground).toContain("5%");

      // Dark primary (L = 30 <= 55) -> primaryForeground must be light (L = 95)
      const darkTheme = generateThemePalette({
        primaryHue: 220,
        primarySaturation: 100,
        primaryLightness: 30,
        surfaceContrast: "deep",
        radius: "default",
      });
      expect(darkTheme.primaryForeground).toContain("95%");
    });

    it("maps all surface contrast levels correctly", () => {
      const levels = ["oled", "deep", "soft", "lifted"] as const;
      const expectedBgLightness = [2, 4, 8, 12];

      levels.forEach((lvl, idx) => {
        const vars = generateThemePalette({
          primaryHue: 200,
          primarySaturation: 50,
          primaryLightness: 50,
          surfaceContrast: lvl,
          radius: "default",
        });
        expect(vars.background).toContain(`${expectedBgLightness[idx]}%`);
      });
    });
  });

  describe("3. Storage Hydration & Corrupt Data Resilience", () => {
    it("handles corrupt localStorage JSON gracefully and recovers to default theme", () => {
      localStorageMock.setItem("nanoforge.theme_palette", "{malformed_json: true,");

      const loaded = loadSavedThemeConfig();
      expect(loaded).toBeNull();

      const resolved = resolveTheme("corrupt_or_non_existent_theme_id");
      expect(resolved.preset?.id).toBe("ember-forge");
    });

    it("resets theme palette cleanly to Ember Forge default preset", () => {
      activateTheme("cyberpunk-neon");
      expect(localStorageMock.getItem("nanoforge.theme_palette")).toContain("cyberpunk-neon");

      const reset = resetThemePalette();
      expect(reset.preset.id).toBe("ember-forge");
      expect(localStorageMock.getItem("nanoforge.theme_palette")).toContain("ember-forge");
    });
  });
});
