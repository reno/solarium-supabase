"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  width?: number;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Dialog({ open, onClose, title, footer, width = 420, children, style }: DialogProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={onClose}
      className="sol-scrim"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--scrim)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflowY: "auto",
        padding: "var(--space-9)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e: MouseEvent) => e.stopPropagation()}
        className="sol-dialog"
        style={{
          width,
          maxWidth: "100%",
          margin: "auto",
          flex: "0 0 auto",
          background: "var(--surface-overlay)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-sheet)",
          boxShadow: "var(--shadow-overlay)",
          overflow: "hidden",
          ...style,
        }}
      >
        {title ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "var(--space-6) var(--space-6) var(--space-6) var(--space-8)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ font: "var(--type-h3)", fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>{title}</span>
            <IconButton icon="x" size="sm" label="Close" onClick={onClose} />
          </div>
        ) : null}
        <div style={{ padding: "var(--space-8)" }}>{children}</div>
        {footer ? (
          <div
            style={{
              display: "flex",
              gap: "var(--space-5)",
              padding: "var(--space-6) var(--space-8) var(--space-8)",
              borderTop: "1px solid var(--border-subtle)",
              background: "var(--surface-1)",
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
