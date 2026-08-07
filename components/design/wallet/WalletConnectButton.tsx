"use client";

import { useState, type CSSProperties } from "react";

import { Button } from "../core/Button";
import { Icon } from "../core/Icon";
import { AddressChip } from "./AddressChip";

export interface WalletConnectButtonProps {
  connected?: boolean;
  address?: string;
  balance?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  style?: CSSProperties;
}

export function WalletConnectButton({ connected, address, balance, onConnect, onDisconnect, style }: WalletConnectButtonProps) {
  const [open, setOpen] = useState(false);
  if (!connected) {
    return (
      <Button variant="primary" icon="wallet" onClick={onConnect} style={style}>
        Connect wallet
      </Button>
    );
  }
  return (
    <div style={{ position: "relative", ...style }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-5)",
          height: "var(--control-h-md)",
          padding: "0 var(--space-5) 0 var(--space-6)",
          background: "var(--surface-2)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-control)",
          cursor: "pointer",
          transition: "var(--transition-control)",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-md)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
          {balance}
          <span style={{ fontSize: "0.78em", marginLeft: 3, color: "var(--text-secondary)" }}>SOL</span>
        </span>
        <span style={{ width: 1, height: 16, background: "var(--border-default)" }} />
        <AddressChip address={address ?? ""} style={{ border: "none", background: "transparent", height: 20, padding: 0 }} />
        <Icon name="chevron-down" size={13} color="var(--text-tertiary)" />
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 80,
            width: 220,
            background: "var(--surface-overlay)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-overlay)",
            padding: "var(--space-4)",
          }}
        >
          {([["Portfolio", "layout-grid"], ["Activity", "list"], ["Settings", "settings"]] as const).map(([l, i]) => (
            <button
              key={l}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-5)",
                width: "100%",
                padding: "var(--space-5)",
                background: "none",
                border: "none",
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-body)",
                fontSize: "var(--text-md)",
                fontFamily: "var(--font-sans)",
                textAlign: "left",
              }}
            >
              <Icon name={i} size={14} />
              {l}
            </button>
          ))}
          <div style={{ height: 1, background: "var(--border-subtle)", margin: "var(--space-4) 0" }} />
          <button
            onClick={onDisconnect}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-5)",
              width: "100%",
              padding: "var(--space-5)",
              background: "none",
              border: "none",
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
              color: "var(--price-down)",
              fontSize: "var(--text-md)",
              fontFamily: "var(--font-sans)",
              textAlign: "left",
            }}
          >
            <Icon name="log-out" size={14} />
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
