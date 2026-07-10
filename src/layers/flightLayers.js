import { IconLayer, LineLayer, ScatterplotLayer, PathLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { altColor } from '../utils/scales.js'
import { destPoint } from '../utils/geo.js'

const dashExt = new PathStyleExtension({ dash: true })

// 机头朝北的飞机剪影(白色,mask 模式下由 getColor 着色)
const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><path fill="#fff" d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`
const PLANE_ICON = {
  url: `data:image/svg+xml;base64,${btoa(PLANE_SVG)}`,
  width: 64,
  height: 64,
  mask: true,
}

// 免费数据源覆盖圈(463km ≈ 250 海里)
function coverageRing(center, radiusKm = 463) {
  const ring = []
  for (let b = 0; b <= 360; b += 6) ring.push(destPoint(center, b, radiusKm))
  return ring
}

export function buildFlightLayers({ flights, trails, selectedHex, center, onClick }) {
  const layers = []

  layers.push(
    new PathLayer({
      id: 'coverage-ring',
      data: [{ path: coverageRing(center) }],
      getPath: (d) => d.path,
      getColor: [77, 163, 255, 70],
      getWidth: 1.5,
      widthUnits: 'pixels',
      getDashArray: [6, 6],
      extensions: [dashExt],
    })
  )

  // 选中飞机的累积航路(按高度分段着色)
  const trail = selectedHex ? trails.get(selectedHex) : null
  if (trail && trail.length > 1) {
    const segs = trail.slice(1).map((p, i) => ({ from: trail[i], to: p }))
    layers.push(
      new LineLayer({
        id: 'flight-trail',
        data: segs,
        getSourcePosition: (d) => d.from.coord,
        getTargetPosition: (d) => d.to.coord,
        getColor: (d) => [...altColor(d.to.altM), 220],
        getWidth: 2.5,
        widthUnits: 'pixels',
        updateTriggers: { getSourcePosition: [trail.length], getTargetPosition: [trail.length] },
      })
    )
  }

  const selected = flights.find((f) => f.hex === selectedHex)
  if (selected) {
    layers.push(
      new ScatterplotLayer({
        id: 'flight-selected-ring',
        data: [selected],
        getPosition: (d) => d.coord,
        getRadius: 20,
        radiusUnits: 'pixels',
        stroked: true,
        filled: false,
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 1.5,
        updateTriggers: { getPosition: [selected.coord] },
      })
    )
  }

  layers.push(
    new IconLayer({
      id: 'planes',
      data: flights,
      pickable: true,
      getIcon: () => PLANE_ICON,
      getPosition: (d) => d.coord,
      getSize: (d) => (d.hex === selectedHex ? 34 : d.onGround ? 16 : 24),
      sizeUnits: 'pixels',
      getColor: (d) => (d.onGround ? [150, 155, 170, 180] : [...altColor(d.altM), 245]),
      getAngle: (d) => -(d.track || 0),
      billboard: false,
      onClick,
      updateTriggers: {
        getSize: [selectedHex],
        getColor: [],
        getAngle: [],
        getPosition: [],
      },
    })
  )

  return layers
}

// 选中飞机脉冲(rAF 直接驱动)
export function flightPulseLayers(selected, t) {
  if (!selected) return []
  const phase = (t % 1500) / 1500
  return [
    new ScatterplotLayer({
      id: 'flight-pulse',
      data: [selected],
      getPosition: (d) => d.coord,
      getRadius: 16 + phase * 22,
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      getLineColor: (d) => [...altColor(d.altM), Math.round(190 * (1 - phase))],
      lineWidthMinPixels: 1.8,
      updateTriggers: { getRadius: [t], getLineColor: [t], getPosition: [selected.coord] },
    }),
  ]
}
