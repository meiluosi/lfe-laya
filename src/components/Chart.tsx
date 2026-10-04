import { useEffect, useRef } from "react";
import { init, use } from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { chartData } from "../demo";
use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
export function Chart() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = init(host.current!);
    chart.setOption({
      animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      grid: { left: 35, right: 18, top: 30, bottom: 60 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#162b28",
        borderColor: "#38524a",
        textStyle: { color: "#e0ebe5" },
      },
      legend: {
        bottom: 0,
        textStyle: { color: "#b6c9bd" },
        data: ["继续学习（示例）", "冻结参数（示例）"],
      },
      xAxis: {
        type: "category",
        data: chartData.times,
        axisLabel: { color: "#829d92" },
        axisLine: { lineStyle: { color: "#2b423a" } },
        axisTick: { show: false },
        name: "秒",
        nameTextStyle: { color: "#829d92" },
      },
      yAxis: {
        type: "value",
        min: 40,
        max: 80,
        name: "能量",
        nameTextStyle: { color: "#829d92" },
        axisLabel: { color: "#829d92" },
        splitLine: { lineStyle: { color: "#213a31", type: "dashed" } },
      },
      series: [
        {
          name: "继续学习（示例）",
          type: "line",
          data: chartData.learning,
          smooth: true,
          symbolSize: 6,
          itemStyle: { color: "#b9dfa5" },
          lineStyle: { width: 3 },
          areaStyle: { color: "#b9dfa5", opacity: 0.05 },
        },
        {
          name: "冻结参数（示例）",
          type: "line",
          data: chartData.frozen,
          smooth: true,
          symbolSize: 5,
          itemStyle: { color: "#ac9fc9" },
          lineStyle: { type: "dashed", width: 2 },
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, []);
  return (
    <div
      ref={host}
      className="chart"
      role="img"
      aria-label="预设示例能量曲线：继续学习从62变为64，冻结参数从62变为63。不能据此认定学习改善。"
    />
  );
}
