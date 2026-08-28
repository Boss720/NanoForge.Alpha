import { useEffect, useState } from "react";

/**
 * Generic media-query hook (roadmap Task 3.2). Unlike `useIsMobile`
 * (hardcoded 768px for the shadcn sidebar primitives), this takes an
 * arbitrary query — the app uses `(max-width: 1023px)` to mirror Tailwind's
 * `lg` breakpoint exactly.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
