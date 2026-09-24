import { FastLineRenderableSeries, NumericAxis, SciChartSurface } from 'scichart';
import type { SensorFeed } from './sensor-feed';

export async function createSensorChart(divId: string, feed: SensorFeed) {
  const { sciChartSurface, wasmContext } = await SciChartSurface.create(divId);
  sciChartSurface.xAxes.add(new NumericAxis(wasmContext));
  sciChartSurface.yAxes.add(new NumericAxis(wasmContext));
  sciChartSurface.renderableSeries.add(new FastLineRenderableSeries(wasmContext, { stroke: '#4682b4' }));

  // TODO: show the feed live. Keep the last 5 minutes visible.
  // TODO: clean up when the chart is removed.
  return sciChartSurface;
}
