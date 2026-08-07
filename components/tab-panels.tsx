"use client";

import { useState, type ReactNode } from "react";

import { Tabs } from "@/components/design";

export type TabSpec = { value: string; label: string };

export function TabPanels({
  tabs,
  panels,
  counts,
  initial,
  size,
  style,
}: {
  tabs: TabSpec[];
  panels: Record<string, ReactNode>;
  counts?: Record<string, number | string>;
  initial?: string;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}) {
  const [value, setValue] = useState(initial ?? tabs[0]?.value);
  return (
    <div style={style}>
      <Tabs tabs={tabs} value={value} onChange={setValue} counts={counts} size={size} />
      <div style={{ paddingTop: "var(--space-8)" }}>{panels[value]}</div>
    </div>
  );
}
