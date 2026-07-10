// 底图源管理:国内外多源候选,启动时测速自动选择
// 注:腾讯/高德为 GCJ-02 坐标系,与 WGS-84 数据叠加在省级缩放下偏移 <1px,
//     台风/地震追踪场景(zoom≤8)可忽略;如需街道级精度请用 CARTO/Esri。

const rasterStyle = (id, tiles, attribution, maxzoom = 17, scheme = 'xyz') => ({
  version: 8,
  sources: {
    [id]: { type: 'raster', tiles, tileSize: 256, scheme, maxzoom, attribution },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0e1a' } },
    { id, type: 'raster', source: id },
  ],
})

export const BASEMAPS = [
  {
    id: 'tencent-dark',
    name: '暗色 · 腾讯（国内推荐）',
    probe: 'https://rt1.map.gtimg.com/tile?z=5&x=26&y=18&styleid=4',
    style: rasterStyle(
      'tencent',
      [0, 1, 2, 3].map((i) => `https://rt${i}.map.gtimg.com/tile?z={z}&x={x}&y={y}&styleid=4`),
      '© 腾讯地图',
      17,
      'tms'
    ),
  },
  {
    id: 'carto-dark',
    name: '暗色 · CARTO（海外/矢量）',
    probe: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  {
    id: 'esri-dark',
    name: '暗灰 · Esri',
    probe: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/3/3/6',
    style: rasterStyle(
      'esri',
      ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
      '© Esri',
      16
    ),
  },
  {
    id: 'amap-light',
    name: '亮色 · 高德（最快）',
    probe: 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=6&y=3&z=3',
    style: rasterStyle(
      'amap',
      [1, 2, 3, 4].map((i) => `https://webrd0${i}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}`),
      '© 高德地图',
      18
    ),
  },
]

export const getBasemap = (id) => BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]

const STORAGE_KEY = 'geopulse.basemap'

export const loadBasemapPref = () => {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}
export const saveBasemapPref = (id) => {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
}

// 并发测速:深色底图(与 UI 配套)中取最快;全挂了才降级亮色高德
export async function pickFastestBasemap(timeoutMs = 3500) {
  const race = (ids, ms) =>
    Promise.any(
      BASEMAPS.filter((b) => ids.includes(b.id) && b.probe).map((b) =>
        fetch(b.probe, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(ms) }).then(() => b.id)
      )
    )
  try {
    return await race(['tencent-dark', 'carto-dark', 'esri-dark'], timeoutMs)
  } catch {
    try {
      return await race(['amap-light'], timeoutMs)
    } catch {
      return 'tencent-dark'
    }
  }
}
