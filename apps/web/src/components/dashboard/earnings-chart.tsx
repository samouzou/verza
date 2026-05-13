
"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import type { EarningsDataPoint } from "@/types"
import type { ChartConfig } from "@/components/ui/chart"

interface EarningsChartProps {
  data: EarningsDataPoint[];
}

const chartConfig = {
  collected: {
    label: "Collected",
    color: "hsl(var(--chart-1))", // Use existing chart colors
  },
  invoiced: {
    label: "Invoiced",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig

export function EarningsChart({ data }: EarningsChartProps) {
  const noData = !data || data.every(d => d.collected === 0 && d.invoiced === 0);

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>Monthly Financials</CardTitle>
        <CardDescription>
          Collected vs. Invoiced amounts for the current year.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {noData ? (
          <div className="flex items-center justify-center h-[300px]">
            <p className="text-muted-foreground">No data to display for the selected period.</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tickFormatter={(value) => `$${value >= 1000 ? `${value / 1000}k` : value}`}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={80}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent indicator="dot" />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="collected" fill="var(--color-collected)" radius={4} />
                <Bar dataKey="invoiced" fill="var(--color-invoiced)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
