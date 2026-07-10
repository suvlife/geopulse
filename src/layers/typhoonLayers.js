import { LineLayer, ScatterplotLayer, PathLayer, PolygonLayer, TextLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { catColor, AGENCY_COLORS } from '../utils/scales.js'
import { windQuadPolygon } from '../utils/geo.js'

const dashExt = new PathStyleExtension({ dash: true })

// 静态图层：风圈、路径、预报线、当前位置核心与标注
export function buildTyphoonLayers({ typhoon, timeIdx, agencies, onClickPoint }) {
  if (!typhoon) return []
  const layers = []
  const visible = typhoon.track.slice(0, timeIdx + 1)
  const current = visible[visible.length - 1]

  // ── 风圈（先画大圈，避免遮挡）─────────────────────────────
  const rings = []
  if (current.r7) rings.push({ radii: current.r7, fill: [255, 216, 74, 34], line: [255, 216, 74, 170] })
  if (current.r10) rings.push({ radii: current.r10, fill: [255, 140, 50, 44], line: [255, 140, 50, 190] })
  if (current.r12) rings.push({ radii: current.r12, fill: [235, 60, 60, 55], line: [235, 60, 60, 210] })
  if (rings.length) {
    layers.push(
      new PolygonLayer({
        id: 'wind-rings',
        data: rings,
        getPolygon: (d) => windQuadPolygon(current.coord, d.radii),
        getFillColor: (d) => d.fill,
        getLineColor: (d) => d.line,
        getLineWidth: 1.4,
        lineWidthUnits: 'pixels',
        stroked: true,
        pickable: false,
        updateTriggers: { getPolygon: [current.time] },
      })
    )
  }

  // ── 已观测路径（按强度分段着色）───────────────────────────
  const segments = visible.slice(1).map((p, i) => ({ from: visible[i], to: p }))
  layers.push(
    new LineLayer({
      id: 'track-line',
      data: segments,
      getSourcePosition: (d) => d.from.coord,
      getTargetPosition: (d) => d.to.coord,
      getColor: (d) => [...catColor(d.to.cat), 230],
      getWidth: 3,
      widthUnits: 'pixels',
    }),
    new ScatterplotLayer({
      id: 'track-points',
      data: visible,
      pickable: true,
      getPosition: (d) => d.coord,
      getRadius: 4.5,
      radiusUnits: 'pixels',
      getFillColor: (d) => [...catColor(d.cat), 240],
      stroked: true,
      getLineColor: [10, 14, 26, 200],
      lineWidthMinPixels: 1,
      onClick: onClickPoint,
    })
  )

  // ── 多机构预报路径（虚线，仅在最新时刻显示）───────────────
  const isLatest = timeIdx === typhoon.track.length - 1
  if (isLatest) {
    for (const [agency, pts] of Object.entries(typhoon.forecasts || {})) {
      if (agencies[agency] === false) continue
      const color = AGENCY_COLORS[agency] || [200, 200, 200]
      layers.push(
        new PathLayer({
          id: `fc-line-${agency}`,
          data: [{ path: [current.coord, ...pts.map((p) => p.coord)] }],
          getPath: (d) => d.path,
          getColor: [...color, 200],
          getWidth: 2,
          widthUnits: 'pixels',
          getDashArray: [7, 5],
          dashJustified: true,
          extensions: [dashExt],
        }),
        new ScatterplotLayer({
          id: `fc-pts-${agency}`,
          data: pts.map((p) => ({ ...p, agency })),
          pickable: true,
          getPosition: (d) => d.coord,
          getRadius: 3.5,
          radiusUnits: 'pixels',
          getFillColor: [...color, 220],
          stroked: true,
          getLineColor: [10, 14, 26, 180],
          lineWidthMinPixels: 1,
        })
      )
    }
  }

  // ── 当前位置核心点 + 名称标注 ────────────────────────────
  layers.push(
    new ScatterplotLayer({
      id: 'ty-core',
      data: [current],
      getPosition: (d) => d.coord,
      getRadius: 7,
      radiusUnits: 'pixels',
      getFillColor: (d) => [...catColor(d.cat), 255],
      stroked: true,
      getLineColor: [255, 255, 255, 230],
      lineWidthMinPixels: 2,
      updateTriggers: { getPosition: [timeIdx] },
    }),
    new TextLayer({
      id: 'ty-label',
      data: [current],
      getPosition: (d) => d.coord,
      getText: () => `${typhoon.name} ${typhoon.enname}`,
      getSize: 15,
      getColor: [255, 255, 255, 235],
      getPixelOffset: [0, -30],
      background: true,
      getBackgroundColor: [10, 14, 26, 190],
      backgroundPadding: [6, 3],
      characterSet: [...new Set(`${typhoon.name} ${typhoon.enname}0123456789`)],
      fontFamily: 'system-ui, sans-serif',
      updateTriggers: { getPosition: [timeIdx] },
    })
  )
  return layers
}

// 动画图层：当前位置脉冲圈，由 rAF 直接驱动
export function typhoonPulseLayers(current, t) {
  if (!current) return []
  const phase = (t % 1400) / 1400
  return [
    new ScatterplotLayer({
      id: 'ty-pulse',
      data: [current],
      getPosition: (d) => d.coord,
      getRadius: 14 + phase * 26,
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      getLineColor: (d) => [...catColor(d.cat), Math.round(210 * (1 - phase))],
      lineWidthMinPixels: 2,
      updateTriggers: { getRadius: [t], getLineColor: [t], getPosition: [current.time] },
    }),
  ]
}
