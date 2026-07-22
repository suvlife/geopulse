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

// 判断轨道点是否在相机朝向的一侧(中心角 < 90° 为近侧)
function isNearSide(lon, lat, camLon, camLat) {
  const la1 = (camLat * Math.PI) / 180
  const la2 = (lat * Math.PI) / 180
  const dLon = ((lon - camLon) * Math.PI) / 180
  const cosc = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dLon)
  return cosc > 0
}

// 把轨道按近/远侧拆成若干段,近侧亮远侧暗,避免远侧穿透地球的视觉混乱
function splitOrbitByVisibility(path, camLon, camLat) {
  const near = [], far = []
  let cur = null
  for (let i = 0; i < path.length; i++) {
    const [lon, lat, alt] = path[i]
    const side = isNearSide(lon, lat, camLon, camLat) ? 'near' : 'far'
    if (cur && cur.side !== side) {
      // 切换侧时把当前点也加入上一段结尾,保证连续
      cur.points.push([lon, lat, alt])
      ;(cur.side === 'near' ? near : far).push(cur.points)
      cur = { side, points: [[lon, lat, alt]] }
    } else if (cur) {
      cur.points.push([lon, lat, alt])
    } else {
      cur = { side, points: [[lon, lat, alt]] }
    }
  }
  if (cur && cur.points.length) (cur.side === 'near' ? near : far).push(cur.points)
  return { near, far }
}

export function buildSatelliteLayers({ satellites, selected, orbitPath, visibleGroups, showFootprint, frame, camera }) {
  const layers = []

  // 地球纹理:必须写深度,否则远侧轨道会穿透地球可见
  layers.push(
    new TileLayer({
      id: 'globe-tiles',
      data: RASTER_TILES,
      minZoom: 0,
      maxZoom: 9,
      tileSize: 256,
      parameters: { depthWriteEnabled: true, depthTest: true },
      renderSubLayers: (props) => {
        const { bbox: { west, south, east, north } } = props.tile
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [west, south, east, north],
          parameters: { depthWriteEnabled: true, depthTest: true },
        })
      },
      onTileError: () => {},
    })
  )

  if (!satellites.length) return layers

  // 分组过滤 + 按组着色
  const visible = satellites.filter((s) => visibleGroups[s.group] !== false && s.alt > 0)

  // 选中卫星:完整轨道线(近侧亮、远侧暗)
  if (selected && orbitPath?.length > 1) {
    const cam = camera || { lon: selected.lon, lat: selected.lat }
    const { near, far } = splitOrbitByVisibility(orbitPath, cam.lon, cam.lat)
    const mk = (segments, color, widthPx) => segments.map((seg, i) => new PathLayer({
      id: `sel-orbit-${color[3] > 100 ? 'near' : 'far'}-${i}`,
      data: [{ path: seg }],
      getPath: (d) => d.path,
      getColor: color,
      getWidth: widthPx,
      widthUnits: 'pixels',
      jointRounded: true,
      parameters: { depthTest: true, depthWriteEnabled: false },
    }))
    layers.push(...mk(far, [255, 255, 255, 60], 1.2))
    layers.push(...mk(near, [255, 255, 255, 230], 2))
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
