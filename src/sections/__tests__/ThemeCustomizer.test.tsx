// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeCustomizer } from "../settings/ThemeCustomizer";
import {
  THEME_PRESETS,
  DEFAULT_THEME_ID,
  CSS_VARIABLE_MAP,
  saveTheme,
  loadSavedThemeConfig,
} from "@/lib/themePalette";

describe("ThemeCustomizer Component", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const cssVar of Object.values(CSS_VARIABLE_MAP)) {
      document.documentElement.style.removeProperty(cssVar);
    }
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    for (const cssVar of Object.values(CSS_VARIABLE_MAP)) {
      document.documentElement.style.removeProperty(cssVar);
    }
  });

  it("renders the header, all 7 presets, controls, and live preview", () => {
    render(<ThemeCustomizer />);

    // Header & Reset
    expect(screen.getByText("Theme & Visual Palette")).toBeInTheDocument();
    expect(screen.getByTestId("reset-theme-btn")).toBeInTheDocument();

    // 7 Presets
    for (const preset of THEME_PRESETS) {
      expect(screen.getByTestId(`preset-card-${preset.id}`)).toBeInTheDocument();
      expect(screen.getByText(preset.name)).toBeInTheDocument();
    }

    // Sliders
    expect(screen.getByTestId("primary-hue-slider")).toBeInTheDocument();
    expect(screen.getByTestId("accent-hue-slider")).toBeInTheDocument();
    expect(screen.getByTestId("primary-saturation-slider")).toBeInTheDocument();
    expect(screen.getByTestId("primary-lightness-slider")).toBeInTheDocument();

    // Contrast & Radius buttons
    expect(screen.getByTestId("contrast-btn-oled")).toBeInTheDocument();
    expect(screen.getByTestId("contrast-btn-deep")).toBeInTheDocument();
    expect(screen.getByTestId("contrast-btn-soft")).toBeInTheDocument();
    expect(screen.getByTestId("contrast-btn-lifted")).toBeInTheDocument();

    expect(screen.getByTestId("radius-btn-none")).toBeInTheDocument();
    expect(screen.getByTestId("radius-btn-compact")).toBeInTheDocument();
    expect(screen.getByTestId("radius-btn-default")).toBeInTheDocument();
    expect(screen.getByTestId("radius-btn-rounded")).toBeInTheDocument();
    expect(screen.getByTestId("radius-btn-pill")).toBeInTheDocument();

    // Live preview
    expect(screen.getByTestId("live-preview-box")).toBeInTheDocument();
    expect(screen.getByText("Live Component Preview")).toBeInTheDocument();
    expect(screen.getByText("Primary Action")).toBeInTheDocument();
  });

  it("shows active checkmark on the default Ember Forge preset initially", () => {
    render(<ThemeCustomizer />);
    expect(screen.getByTestId(`active-preset-check-${DEFAULT_THEME_ID}`)).toBeInTheDocument();
  });

  it("switches presets on click, updates CSS variables in DOM, and persists to localStorage", async () => {
    const user = userEvent.setup();
    render(<ThemeCustomizer />);

    // Click Cyberpunk Neon
    const cyberpunkCard = screen.getByTestId("preset-card-cyberpunk-neon");
    await user.click(cyberpunkCard);

    // Active indicator moved
    expect(screen.getByTestId("active-preset-check-cyberpunk-neon")).toBeInTheDocument();
    expect(screen.queryByTestId(`active-preset-check-${DEFAULT_THEME_ID}`)).not.toBeInTheDocument();

    // CSS variables mutated on documentElement
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("185 100% 50%");
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("0.25rem");

    // LocalStorage updated
    const saved = loadSavedThemeConfig();
    expect(saved?.id).toBe("cyberpunk-neon");
  });

  it("adjusts primary hue via slider and updates CSS variable immediately", () => {
    render(<ThemeCustomizer />);

    const hueSlider = screen.getByTestId("primary-hue-slider") as HTMLInputElement;
    fireEvent.change(hueSlider, { target: { value: "280" } });

    expect(hueSlider.value).toBe("280");
    const currentPrimary = document.documentElement.style.getPropertyValue("--primary");
    expect(currentPrimary).toContain("280");

    const saved = loadSavedThemeConfig();
    expect(saved?.primaryHue).toBe(280);
    expect(saved?.isCustom).toBe(true);
  });

  it("adjusts saturation and lightness sliders and updates variables in real-time", () => {
    render(<ThemeCustomizer />);

    const satSlider = screen.getByTestId("primary-saturation-slider") as HTMLInputElement;
    fireEvent.change(satSlider, { target: { value: "85" } });
    expect(satSlider.value).toBe("85");

    const lightSlider = screen.getByTestId("primary-lightness-slider") as HTMLInputElement;
    fireEvent.change(lightSlider, { target: { value: "65" } });
    expect(lightSlider.value).toBe("65");

    const currentPrimary = document.documentElement.style.getPropertyValue("--primary");
    expect(currentPrimary).toContain("85% 65%");
  });

  it("adjusts surface contrast to OLED Black and updates background lightness", async () => {
    const user = userEvent.setup();
    render(<ThemeCustomizer />);

    const oledBtn = screen.getByTestId("contrast-btn-oled");
    await user.click(oledBtn);

    const bg = document.documentElement.style.getPropertyValue("--background");
    expect(bg).toContain("2%");

    const saved = loadSavedThemeConfig();
    expect(saved?.surfaceContrast).toBe("oled");
  });

  it("adjusts border radius to Pill and updates --radius CSS variable", async () => {
    const user = userEvent.setup();
    render(<ThemeCustomizer />);

    const pillBtn = screen.getByTestId("radius-btn-pill");
    await user.click(pillBtn);

    const radius = document.documentElement.style.getPropertyValue("--radius");
    expect(radius).toBe("1rem");

    const saved = loadSavedThemeConfig();
    expect(saved?.radius).toBe("pill");
  });

  it("resets to Ember Forge default preset when clicking Reset to Default", async () => {
    const user = userEvent.setup();
    render(<ThemeCustomizer />);

    // First change to Cyberpunk Neon
    await user.click(screen.getByTestId("preset-card-cyberpunk-neon"));
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("185 100% 50%");

    // Click Reset
    const resetBtn = screen.getByTestId("reset-theme-btn");
    await user.click(resetBtn);

    // Restored to Ember Forge
    expect(screen.getByTestId(`active-preset-check-${DEFAULT_THEME_ID}`)).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("32 100% 55%");

    const saved = loadSavedThemeConfig();
    expect(saved?.id).toBe(DEFAULT_THEME_ID);
  });

  it("initializes with saved configuration if present in localStorage", () => {
    saveTheme({
      id: "emerald-matrix",
      name: "Emerald Matrix",
      primaryHue: 155,
      primarySaturation: 100,
      primaryLightness: 45,
      surfaceContrast: "deep",
      radius: "compact",
      isCustom: false,
    });

    render(<ThemeCustomizer />);
    expect(screen.getByTestId("active-preset-check-emerald-matrix")).toBeInTheDocument();
  });
});
