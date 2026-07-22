import { BitmapLayer, ScatterplotLayer, PathLayer, TextLayer } from '@deck.gl/layers'
import { TileLayer } from '@deck.gl/geo-layers'
import { _GlobeView } from '@deck.gl/core'

// 星座颜色(参考 OrbitLive)
export const GROUP_COLORS = {
  starlink: [91, 192, 235],
  oneweb: [190, 132, 255],
  stations: [255, 255, 255],
  gps: [61, 220, 151],
  beidou: [255, 200, 60],
  glonass: [255, 140, 70],
  galileo: [150, 170, 255],
  iridium: [255, 105, 150],
  weather: [60, 230, 220],
  others: [160, 165, 185],
}

export const GROUP_LABELS = {
  starlink: '星链 Starlink',
  oneweb: '一网 OneWeb',
  stations: '空间站',
  gps: 'GPS',
  beidou: '北斗 BeiDou',
  glonass: '格洛纳斯 GLONASS',
  galileo: '伽利略 Galileo',
  iridium: '铱星 Iridium',
  weather: '气象 Weather',
  others: '其他 Others',
}

// 地球纹理:NASA Blue Marble 风(昼夜分面用 Sunlit 效果更好,这里用暗色版)
const GLOBE_TILES = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// 实际用 raster 版,CARTO 暗色
const RASTER_TILES = 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'

// 星下点覆盖圈
function footprintRing(lon, lat, alt, radiusKm = 400) {
  const R = 6371
  const alpha = (radiusKm / R) * (180 / Math.PI)
  const ring = []
  for (let b = 0; b <= 360; b += 10) {
    const br = (b * Math.PI) / 180
    const latRad = (lat * Math.PI) / 180
    const dLat = Math.asin(
      Math.sin(latRad) * Math.cos((alpha * Math.PI) / 180) +
      Math.cos(latRad) * Math.sin((alpha * Math.PI) / 180) * Math.cos(br)
    )
    const dLon = (lon * Math.PI) / 180 + Math.atan2(
      Math.sin(br) * Math.sin((alpha * Math.PI) / 180) * Math.cos(latRad),
      Math.cos((alpha * Math.PI) / 180) - Math.sin(latRad) * Math.sin(dLat)
    )
    ring.push([(dLon * 180) / Math.PI, (dLat * 180) / Math.PI, 0])
  }
  return ring
}

export function getGlobeView() {
  return new _GlobeView({ id: 'globe', resolution: 10 })
}

export function buildSatelliteLayers({ satellites, selected, orbitPath, visibleGroups, showFootprint, frame }) {
  const layers = []

  // 地球纹理
  layers.push(
    new TileLayer({
      id: 'globe-tiles',
      data: RASTER_TILES,
      minZoom: 0,
      maxZoom: 9,
      tileSize: 256,
      renderSubLayers: (props) => {
        const { bbox: { west, south, east, north } } = props.tile
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [west, south, east, north],
        })
      },
      onTileError: () => {},
    })
  )

  if (!satellites.length) return layers

  // 分组过滤 + 按组着色
  const visible = satellites.filter((s) => visibleGroups[s.group] !== false && s.alt > 0)

  // 选中卫星:完整轨道线
  if (selected && orbitPath?.length > 1) {
    layers.push(
      new PathLayer({
        id: 'sel-orbit',
        data: [{ path: orbitPath }],
        getPath: (d) => d.path,
        getColor: [255, 255, 255, 200],
        getWidth: 1.6,
        widthUnits: 'pixels',
        jointRounded: true,
      })
    )
  }

  // 选中卫星覆盖圈
  if (selected && showFootprint) {
    layers.push(
      new PathLayer({
        id: 'sel-footprint',
        data: [selected],
        getPath: (d) => footprintRing(d.lon, d.lat, d.alt),
        getColor: [255, 255, 255, 90],
        getWidth: 1.2,
        widthUnits: 'pixels',
      })
    )
  }

  // 选中卫星高亮点
  if (selected) {
    layers.push(
      new ScatterplotLayer({
        id: 'sel-highlight',
        data: [selected],
        getPosition: (d) => [d.lon, d.lat, d.alt],
        getRadius: 120000,
        radiusUnits: 'meters',
        radiusMinPixels: 7,
        radiusMaxPixels: 16,
        getFillColor: [255, 255, 255, 240],
        stroked: true,
        getLineColor: [...(GROUP_COLORS[selected.group] || GROUP_COLORS.others), 220],
        lineWidthMinPixels: 2,
      })
    )
  }

  // 卫星散点(全量);位置被 rAF 原地更新,用 frame 作 updateTrigger 强制重读
  layers.push(
    new ScatterplotLayer({
      id: 'satellites',
      data: visible,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat, d.alt],
      getRadius: (d) => {
        if (d.id === selected?.id) return 0 // 选中点用高亮层
        switch (d.group) {
          case 'stations': return 100000
          case 'starlink': return 18000
          case 'gps': case 'beidou': case 'glonass': case 'galileo': return 35000
          default: return 22000
        }
      },
      radiusUnits: 'meters',
      radiusMinPixels: (d) => (d.group === 'starlink' ? 1 : 1.5),
      radiusMaxPixels: (d) => (d.group === 'stations' ? 10 : 5),
      getFillColor: (d) => [...(GROUP_COLORS[d.group] || GROUP_COLORS.others), 220],
      updateTriggers: {
        getPosition: [frame],
        getFillColor: [visibleGroups],
        getRadius: [selected?.id],
      },
    })
  )

  // 选中卫星标签
  if (selected) {
    layers.push(
      new TextLayer({
        id: 'sel-label',
        data: [selected],
        getPosition: (d) => [d.lon, d.lat, d.alt],
        getText: (d) => d.name,
        getSize: 14,
        getColor: [255, 255, 255, 240],
        getPixelOffset: [0, -22],
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
