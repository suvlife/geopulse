import { ScatterplotLayer } from '@deck.gl/layers'
import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import { magColor, depthColor, magRadius } from '../utils/scales.js'

const HEAT_COLORS = [
  [8, 48, 107, 0],
  [33, 113, 181, 90],
  [66, 190, 190, 140],
  [255, 216, 74, 180],
  [255, 128, 60, 220],
  [231, 60, 60, 255],
]

// 静态图层：仅在数据/配置变化时重建
export function buildQuakeLayers({ quakes, colorBy, heatmap, onClick }) {
  if (!quakes.length) return []
  if (heatmap) {
    return [
      new HeatmapLayer({
        id: 'quake-heat',
        data: quakes,
        getPosition: (d) => d.coord,
        getWeight: (d) => Math.pow(2, d.mag),
        radiusPixels: 46,
        intensity: 1.1,
        colorRange: HEAT_COLORS,
      }),
    ]
  }
  const colorFn = colorBy === 'depth' ? (d) => depthColor(d.depth) : (d) => magColor(d.mag)
  return [
    new ScatterplotLayer({
      id: 'quakes',
      data: quakes,
      pickable: true,
      getPosition: (d) => d.coord,
      getRadius: (d) => magRadius(d.mag) * 1000,
      radiusUnits: 'meters',
      radiusMinPixels: 2.5,
      radiusMaxPixels: 40,
      getFillColor: (d) => [...colorFn(d), 185],
      stroked: true,
      getLineColor: [255, 255, 255, 60],
      lineWidthMinPixels: 0.5,
      onClick,
      updateTriggers: { getFillColor: [colorBy] },
    }),
  ]
}

// 动画图层：由 rAF 循环直接驱动，不经过 React 渲染
export function quakePulseLayers(recent, t) {
  if (!recent.length) return []
  const phase = (t % 1600) / 1600
  return [
    new ScatterplotLayer({
      id: 'quake-pulse',
      data: recent,
      getPosition: (d) => d.coord,
      getRadius: (d) => magRadius(d.mag) * 1000 * (1 + phase * 2.4),
      radiusUnits: 'meters',
      radiusMinPixels: 5,
      radiusMaxPixels: 110,
      stroked: true,
      filled: false,
      getLineColor: (d) => [...magColor(d.mag), Math.round(190 * (1 - phase))],
      lineWidthMinPixels: 1.6,
      updateTriggers: { getRadius: [t], getLineColor: [t] },
    }),
  ]
}
