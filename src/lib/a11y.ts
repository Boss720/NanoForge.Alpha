/**
 * NanoForge Accessibility (A11y) & Visual Calming Engine
 *
 * Provides:
 * - Reduced motion toggling
 * - High-contrast mode toggling (WCAG AAA compliant contrast)
 * - UI Density switcher (compact, default, comfortable)
 * - Font scaling adjustment (small, default, large, xlarge)
 * - Persistent storage in localStorage with zero-reload DOM hydration
 */

import { useState, useEffect, useCallback } from "react";

export type UiDensity = "compact" | "default" | "comfortable";
export type FontScale = "small" | "default" | "large" | "xlarge";

export interface A11yPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  density: UiDensity;
  fontScale: FontScale;
}

export const A11Y_STORAGE_KEY = "nanoforge.a11y.preferences";

export const DEFAULT_A11Y_PREFERENCES: A11yPreferences = {
  reducedMotion: false,
  highContrast: false,
  density: "default",
  fontScale: "default",
};

/**
 * Loads saved accessibility preferences from localStorage safely.
 */
export function loadA11yPreferences(): A11yPreferences {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_A11Y_PREFERENCES };
    const raw = localStorage.getItem(A11Y_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_A11Y_PREFERENCES };
    const parsed = JSON.parse(raw);
    return {
      reducedMotion: typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : DEFAULT_A11Y_PREFERENCES.reducedMotion,
      highContrast: typeof parsed.highContrast === "boolean" ? parsed.highContrast : DEFAULT_A11Y_PREFERENCES.highContrast,
      density: ["compact", "default", "comfortable"].includes(parsed.density) ? parsed.density : DEFAULT_A11Y_PREFERENCES.density,
      fontScale: ["small", "default", "large", "xlarge"].includes(parsed.fontScale) ? parsed.fontScale : DEFAULT_A11Y_PREFERENCES.fontScale,
    };
  } catch {
    return { ...DEFAULT_A11Y_PREFERENCES };
  }
}

/**
 * Saves accessibility preferences to localStorage.
 */
export function saveA11yPreferences(prefs: Partial<A11yPreferences>): A11yPreferences {
  const current = loadA11yPreferences();
  const updated: A11yPreferences = { ...current, ...prefs };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {
    /* ignore storage errors */
  }
  return updated;
}

/**
 * Applies accessibility classes and data attributes to the document root element.
 */
export function applyA11yPreferences(prefs: A11yPreferences): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;

  // 1. Reduced motion
  if (prefs.reducedMotion) {
    root.classList.add("reduced-motion");
  } else {
    root.classList.remove("reduced-motion");
  }

  // 2. High contrast
  if (prefs.highContrast) {
    root.classList.add("high-contrast");
  } else {
    root.classList.remove("high-contrast");
  }

  // 3. UI Density
  root.setAttribute("data-density", prefs.density);

  // 4. Font Scaling
  root.setAttribute("data-font-scale", prefs.fontScale);
}

/**
 * Hydrates accessibility settings on application boot.
 */
export function initA11yPreferences(): A11yPreferences {
  const prefs = loadA11yPreferences();
  applyA11yPreferences(prefs);
  return prefs;
}

/**
 * React hook for live accessibility preferences binding.
 */
export function useA11yPreferences() {
  const [preferences, setPreferencesState] = useState<A11yPreferences>(() => loadA11yPreferences());

  useEffect(() => {
    applyA11yPreferences(preferences);
  }, [preferences]);

  const updatePreferences = useCallback((partial: Partial<A11yPreferences>) => {
    const updated = saveA11yPreferences(partial);
    setPreferencesState(updated);
    applyA11yPreferences(updated);
  }, []);

  return { preferences, updatePreferences };
}
