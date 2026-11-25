import { useEffect, useRef, useState } from "react";

/**
 * Remembering where you were. Lives in sessionStorage (this tab only, gone when the tab closes); every access is
 * wrapped so a private window or blocked storage only loses the convenience, never breaks the page.
 */
const get = (k: string): string | null => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string) => {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    // convenience only
  }
};

/** The list page you were on before opening a game (Picks, Goals, Games, History). */
export const lastListRoute = () => get("nav:last") ?? "#/";
export const setLastListRoute = (route: string) => put("nav:last", route || "#/");

/** useState that survives leaving the page and coming back in the same tab. */
export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((cur: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    const s = get(`state:${key}`);
    if (s === null) return initial;
    try {
      return JSON.parse(s) as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => put(`state:${key}`, JSON.stringify(v)), [key, v]);
  return [v, setV];
}

/** Saves the scroll position of a page while you use it, and puts it back once the page's data has loaded. */
export function useScrollMemory(key: string, ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    const save = () => put(`scroll:${key}`, String(window.scrollY));
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [key]);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const y = Number(get(`scroll:${key}`) ?? 0);
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [key, ready]);
}
