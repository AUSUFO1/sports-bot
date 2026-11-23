export type Theme = "system" | "light" | "dark";
const KEY = "sb_theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system"; // storage blocked: follow the device setting
  }
}

/** Sets data-theme on <html>; "system" removes it so the device setting decides. */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0b0c" : "#ffffff");
}

export function setTheme(t: Theme): void {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* the choice still applies until the page closes */
  }
  applyTheme(t);
}

/** True when the page is currently showing dark colours. */
export function isDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" || (attr === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
