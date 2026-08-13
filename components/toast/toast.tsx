"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/design";

export type ToastProps = {
  title: string;
  message?: string;
  type?: "success" | "error" | "info";
  duration?: number;
  onDismiss?: () => void;
};

export function Toast({ title, message, type = "success", onDismiss }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const iconName = type === "success" ? "check-circle" : type === "error" ? "x-circle" : "info";
  const accentColor =
    type === "success"
      ? "var(--price-up)"
      : type === "error"
        ? "var(--price-down)"
        : "var(--accent)";

  return (
    <div
      className="sol-toast"
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-5)",
        minWidth: 320,
        maxWidth: 420,
        padding: "var(--space-6) var(--space-7)",
        background: "var(--surface-overlay)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-overlay)",
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.2s ease-out, transform 0.2s ease-out",
      }}
    >
      <Icon name={iconName} size={18} color={accentColor} style={{ marginTop: 1, flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-primary)",
          }}
        >
          {title}
        </div>
        {message && (
          <div
            style={{
              marginTop: 2,
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
            }}
          >
            {message}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          flex: "0 0 auto",
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: "pointer",
          color: "var(--text-tertiary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-label="Dismiss"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
