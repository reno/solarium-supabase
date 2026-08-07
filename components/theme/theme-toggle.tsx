"use client";

import { useSyncExternalStore } from "react";

import { Icon } from "@/components/design";

const STORAGE_KEY = "solarium:theme";

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
function getSnapshot(): "dark" | "light" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function getServerSnapshot(): "dark" | "light" {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
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
