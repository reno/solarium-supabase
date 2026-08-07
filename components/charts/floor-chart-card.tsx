"use client";

import { FloorChart } from "@/components/design";

/** Client wrapper so the design FloorChart (which renders <button onClick>) can be used
 *  from server-rendered pages. Solarium has no multi-range history yet, so a single "All"
 *  range is shown rather than a misleading range switcher. */
export function FloorChartCard({ data, height = 180 }: { data: number[]; height?: number }) {
  return <FloorChart data={data} height={height} ranges={["All"]} range="All" />;
}
