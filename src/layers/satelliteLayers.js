import { BitmapLayer, ScatterplotLayer, PathLayer, TextLayer } from '@deck.gl/layers'
import { TileLayer } from '@deck.gl/geo-layers'
import { _GlobeView } from '@deck.gl/core'

// 卫星颜色
export const GROUP_COLORS = {
  station: [255, 255, 255],
  starlink: [100, 200, 255],
  gps: [255, 200, 50],
  active: [255, 140, 60],
  other: [140, 150, 170],
}

// 星下点覆盖圈(地面投影,高度=0)
function footprintRing(lon, lat, alt, radiusKm = 300) {
  const R = 6371
  const h = alt / 1000
  const alpha = (radiusKm / R) * (180 / Math.PI)
  const ring = []
  for (let b = 0; b <= 360; b += 15) {
    const br = (b * Math.PI) / 180
    const dLat = Math.asin(Math.sin(lat * Math.PI / 180) * Math.cos(alpha * Math.PI / 180) +
      Math.cos(lat * Math.PI / 180) * Math.sin(alpha * Math.PI / 180) * Math.cos(br))
    const dLon = (lon * Math.PI / 180) + Math.atan2(
      Math.sin(br) * Math.sin(alpha * Math.PI / 180) * Math.cos(lat * Math.PI / 180),
      Math.cos(alpha * Math.PI / 180) - Math.sin(lat * Math.PI / 180) * Math.sin(dLat)
    )
    ring.push([(dLon * 180) / Math.PI, (dLat * 180) / Math.PI, 0])
  }
  return ring
}

// 轨道线:基于当前高度的大圆,绕地球 2 圈
function orbitArc(lon, lat, alt, inclination = 45) {
  const pts = []
  const rawAlt = alt / 1000
  const R = 6371
  const h = R + rawAlt
  // 简化:沿航向角 ±180° 拉出大圆弧
  for (let i = -180; i <= 180; i += 3) {
    const br = (i * Math.PI) / 180
    const cosD = Math.cos(i * Math.PI / 180)
    const sinD = Math.sin(i * Math.PI / 180)
    const latRad = (lat * Math.PI) / 180
    const dLat = Math.asin(Math.sin(latRad) * cosD)
    const dLonRad = (lon * Math.PI) / 180 + Math.atan2(sinD * Math.cos(latRad), cosD - Math.sin(latRad) * Math.sin(dLat))
    pts.push([(dLonRad * 180) / Math.PI, (dLat * 180) / Math.PI, rawAlt * 1000])
  }
  return pts
}

export function getGlobeView() {
  return new _GlobeView({
    id: 'globe',
    resolution: 10,
  })
}

const GLOBE_TILES = 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'

export function buildSatelliteLayers({ satellites, selectedId, showOrbits, showFootprints, showLabels }) {
  const layers = []

  // 地球纹理: 用 BitmapLayer 渲染 CARTO 暗色栅格瓦片
  layers.push(
    new TileLayer({
      id: 'globe-tiles',
      data: GLOBE_TILES,
      minZoom: 0,
      maxZoom: 8,
      tileSize: 256,
      renderSubLayers: (props) => {
        const { bbox: { west, south, east, north } } = props.tile
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [west, south, east, north],
        })
      },
      onTileError: () => { /* 忽略瓦片缺失 */ },
    })
  )

  if (!satellites.length) return layers

  const selected = satellites.find((s) => s.id === selectedId)

  // 轨道线
  if (showOrbits) {
    const orbitData = selected ? [selected] : satellites.filter((s) => s.group === 'station')
    layers.push(
      new PathLayer({
        id: 'sat-orbits',
        data: orbitData,
        getPath: (d) => orbitArc(d.lon, d.lat, d.alt),
        getColor: (d) => [...GROUP_COLORS[d.group] || GROUP_COLORS.other, 80],
        getWidth: 1.2,
        widthUnits: 'pixels',
        jointRounded: true,
      })
    )
  }

  // 星下点覆盖圈
  if (showFootprints) {
    const fpData = selected ? [selected] : satellites.filter((s) => s.group === 'station' || s.group === 'gps')
    layers.push(
      new PathLayer({
        id: 'sat-footprints',
        data: fpData,
        getPath: (d) => footprintRing(d.lon, d.lat, d.alt),
        getColor: (d) => [...GROUP_COLORS[d.group] || GROUP_COLORS.other, 50],
        getWidth: 1,
        widthUnits: 'pixels',
      })
    )
  }

  // 选中卫星高亮环
  if (selected) {
    layers.push(
      new ScatterplotLayer({
        id: 'sat-selected',
        data: [selected],
        getPosition: (d) => [d.lon, d.lat, d.alt],
        getRadius: 80000,
        radiusUnits: 'meters',
        radiusMinPixels: 8,
        radiusMaxPixels: 18,
        getFillColor: [255, 255, 255, 220],
        stroked: true,
        getLineColor: [255, 255, 255, 80],
        lineWidthMinPixels: 2,
      })
    )
  }

  // 卫星散点
  layers.push(
    new ScatterplotLayer({
      id: 'satellites',
      data: satellites,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat, d.alt],
      getRadius: (d) => {
        switch (d.group) {
          case 'station': return 120000
          case 'starlink': return 20000
          case 'gps': return 40000
          default: return 30000
        }
      },
      radiusUnits: 'meters',
      radiusMinPixels: (d) => d.group === 'starlink' ? 1.2 : 2.5,
      radiusMaxPixels: (d) => d.group === 'station' ? 14 : 8,
      getFillColor: (d) => [...GROUP_COLORS[d.group] || GROUP_COLORS.other, 230],
    })
  )

  // 标签
  if (showLabels) {
    const labelData = selected ? [selected] : satellites.filter((s) => s.group === 'station')
    layers.push(
      new TextLayer({
        id: 'sat-labels',
        data: labelData,
        getPosition: (d) => [d.lon, d.lat, d.alt],
        getText: (d) => d.name,
        getSize: 13,
        getColor: [255, 255, 255, 220],
        getPixelOffset: [0, -18],
        background: true,
        getBackgroundColor: [10, 14, 26, 180],
        backgroundPadding: [5, 3],
        characterSet: 'auto',
        fontFamily: 'system-ui, sans-serif',
      })
    )
  }

  return layers
}