"use client";

import { useSyncExternalStore } from "react";

import { Icon } from "@/components/design";

const STORAGE_KEY = "solarium:theme";

// The [data-theme] attribute on <html> is the source of truth (set before paint by the
// inline script in app/layout.tsx). We read it via useSyncExternalStore — subscribing to
// attribute mutations — so the button stays in sync without a setState-in-effect.
function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
function getSnapshot(): "dark" | "light" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function getServerSnapshot(): "dark" | "light" {
  return "dark"; // Matches the SSR default set on <html> in the layout.
}

/** Sun/moon toggle for the [data-theme] attribute. Mutating the attribute drives the
 *  re-render (via the MutationObserver above), so toggle() only touches DOM + storage. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage failures (private mode etc.); the in-page toggle still works.
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title="Toggle theme"
      style={{
        width: 30,
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-control)",
        color: "var(--text-secondary)",
        cursor: "pointer",
        transition: "var(--transition-control)",
      }}
    >
      <Icon name={theme === "light" ? "moon" : "sun"} size={15} />
    </button>
  );
}
