import { IconLayer, ScatterplotLayer, TextLayer, PathLayer } from '@deck.gl/layers'
import { SHIP_TYPE_COLORS, SHIP_TYPE_LABELS, PORTS } from '../data/shipData.js'

// 船形 SVG(尖头船,朝北)
const SHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><path fill="#fff" d="M12 1 L16 7 L16 20 L12 23 L8 20 L8 7 Z M12 4 L14 8 L14 19 L12 21 L10 19 L10 8 Z"/></svg>`
const SHIP_ICON = {
  url: `data:image/svg+xml;base64,${btoa(SHIP_SVG)}`,
  width: 64,
  height: 64,
  mask: true,
}

export function buildShipLayers({ ships, selected, colorBy, visibleTypes, visibleCountries, onClick }) {
  const layers = []

  // 港口标记
  layers.push(
    new ScatterplotLayer({
      id: 'ports',
      data: PORTS,
      pickable: true,
      getPosition: (d) => d.coord,
      getRadius: 30000,
      radiusUnits: 'meters',
      radiusMinPixels: 5,
      radiusMaxPixels: 10,
      getFillColor: [255, 200, 60, 220],
      stroked: true,
      getLineColor: [255, 255, 255, 180],
      lineWidthMinPixels: 1.5,
    }),
    new TextLayer({
      id: 'port-labels',
      data: PORTS,
      getPosition: (d) => d.coord,
      getText: (d) => `⚓ ${d.name}`,
      getSize: 13,
      getColor: [255, 215, 100, 235],
      getPixelOffset: [0, -18],
      background: true,
      getBackgroundColor: [10, 14, 26, 180],
      backgroundPadding: [5, 3],
      characterSet: 'auto',
      fontFamily: 'system-ui, sans-serif',
    })
  )

  if (!ships.length) return layers

  // 过滤
  const visible = ships.filter((s) => {
    if (!s.coord) return false
    if (visibleTypes && visibleTypes[s.type] === false) return false
    if (visibleCountries && visibleCountries.size && !visibleCountries.has(s.country)) return false
    return true
  })

  const colorFn = (s) => {
    if (colorBy === 'country') {
      // 按国籍哈希着色
      let h = 0
      for (const c of s.country) h = (h * 31 + c.charCodeAt(0)) % 360
      const [r, g, b] = hslToRgb(h / 360, 0.7, 0.6)
      return [r, g, b]
    }
    if (colorBy === 'speed') {
      const v = Math.min(1, (s.speedKnots || 0) / 20)
      const [r, g, b] = hslToRgb((1 - v) * 0.66, 0.85, 0.55) // 蓝(慢)→红(快)
      return [r, g, b]
    }
    return SHIP_TYPE_COLORS[s.type] || SHIP_TYPE_COLORS.other
  }

  function hslToRgb(h, s, l) {
    let r, g, b
    if (s === 0) { r = g = b = l } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q
      r = hue2rgb(p, q, h + 1 / 3)
      g = hue2rgb(p, q, h)
      b = hue2rgb(p, q, h - 1 / 3)
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
  }

  // 船舶图标
  layers.push(
    new IconLayer({
      id: 'ships',
      data: visible,
      pickable: true,
      getIcon: () => SHIP_ICON,
      getPosition: (d) => d.coord,
      getSize: (d) => (d.id === selected?.id ? 34 : d.type === 'tug' || d.type === 'fishing' ? 16 : 22),
      sizeUnits: 'pixels',
      getColor: (d) => (d.id === selected?.id ? [255, 255, 255, 255] : [...colorFn(d), 235]),
      getAngle: (d) => -(d.bearing || 0),
      billboard: false,
      onClick,
      updateTriggers: {
        getColor: [colorBy, selected?.id],
        getSize: [selected?.id],
        getPosition: [],
      },
    })
  )

  // 选中船高亮环
  if (selected) {
    layers.push(
      new ScatterplotLayer({
        id: 'ship-highlight',
        data: [selected],
        getPosition: (d) => d.coord,
        getRadius: 40000,
        radiusUnits: 'meters',
        radiusMinPixels: 14,
        radiusMaxPixels: 22,
        stroked: true,
        filled: false,
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 2,
      }),
      new TextLayer({
        id: 'ship-label',
        data: [selected],
        getPosition: (d) => d.coord,
        getText: (d) => d.name,
        getSize: 14,
        getColor: [255, 255, 255, 240],
        getPixelOffset: [0, -26],
        background: true,
        getBackgroundColor: [10, 14, 26, 190],
        backgroundPadding: [6, 3],
        characterSet: 'auto',
        fontFamily: 'system-ui, sans-serif',
      })
    )
  }

  return layers
}
