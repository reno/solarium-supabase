"use client";

import { FloorChart } from "@/components/design";

export function FloorChartCard({ data, height = 180 }: { data: number[]; height?: number }) {
  return <FloorChart data={data} height={height} ranges={["All"]} range="All" />;
}
