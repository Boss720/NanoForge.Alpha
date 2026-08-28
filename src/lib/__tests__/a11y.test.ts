// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadA11yPreferences,
  saveA11yPreferences,
  applyA11yPreferences,
  initA11yPreferences,
  DEFAULT_A11Y_PREFERENCES,
  A11Y_STORAGE_KEY,
} from "../a11y";

describe("a11y — Accessibility Preferences & Visual Calming Engine", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-density");
    document.documentElement.removeAttribute("data-font-scale");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("loads default accessibility preferences when storage is empty", () => {
    const prefs = loadA11yPreferences();
    expect(prefs).toEqual(DEFAULT_A11Y_PREFERENCES);
    expect(prefs.reducedMotion).toBe(false);
    expect(prefs.highContrast).toBe(false);
    expect(prefs.density).toBe("default");
    expect(prefs.fontScale).toBe("default");
  });

  it("persists and reloads updated accessibility preferences", () => {
    const updated = saveA11yPreferences({
      reducedMotion: true,
      highContrast: true,
      density: "compact",
      fontScale: "large",
    });

    expect(updated.reducedMotion).toBe(true);
    expect(updated.highContrast).toBe(true);
    expect(updated.density).toBe("compact");
    expect(updated.fontScale).toBe("large");

    const reloaded = loadA11yPreferences();
    expect(reloaded).toEqual(updated);
  });

  it("applies reduced-motion and high-contrast classes to document.documentElement", () => {
    applyA11yPreferences({
      reducedMotion: true,
      highContrast: true,
      density: "comfortable",
      fontScale: "xlarge",
    });

    expect(document.documentElement.classList.contains("reduced-motion")).toBe(true);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
    expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
    expect(document.documentElement.getAttribute("data-font-scale")).toBe("xlarge");

    // Toggle off
    applyA11yPreferences({
      reducedMotion: false,
      highContrast: false,
      density: "compact",
      fontScale: "small",
    });

    expect(document.documentElement.classList.contains("reduced-motion")).toBe(false);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    expect(document.documentElement.getAttribute("data-font-scale")).toBe("small");
  });

  it("hydrates saved settings on initA11yPreferences boot", () => {
    localStorage.setItem(
      A11Y_STORAGE_KEY,
      JSON.stringify({
        reducedMotion: true,
        highContrast: false,
        density: "compact",
        fontScale: "large",
      })
    );

    const hydrated = initA11yPreferences();
    expect(hydrated.reducedMotion).toBe(true);
    expect(document.documentElement.classList.contains("reduced-motion")).toBe(true);
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    expect(document.documentElement.getAttribute("data-font-scale")).toBe("large");
  });
});
