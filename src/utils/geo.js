// 地理计算工具
const R = 6371 // 地球半径 km
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

export function haversine([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// 从某点沿方位角走 dist km 后的坐标
export function destPoint([lon, lat], bearing, dist) {
  const br = rad(bearing)
  const d = dist / R
  const la1 = rad(lat)
  const lo1 = rad(lon)
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br)
  )
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2)
    )
  return [deg(lo2), deg(la2)]
}

// 非对称风圈：四象限半径（km）→ 多边形环
// radii: { ne, se, sw, nw }
export function windQuadPolygon(center, radii, stepsPerQuad = 16) {
  const quads = [
    [0, radii.ne],
    [90, radii.se],
    [180, radii.sw],
    [270, radii.nw],
  ]
  const ring = []
  for (let q = 0; q < 4; q++) {
    const [startBearing] = quads[q]
    const r0 = quads[q][1]
    const r1 = quads[(q + 1) % 4][1]
    for (let i = 0; i < stepsPerQuad; i++) {
      const t = i / stepsPerQuad
      const bearing = startBearing + t * 90
      // 象限间半径平滑过渡
      const r = r0 + (r1 - r0) * t
      ring.push(destPoint(center, bearing, r))
    }
  }
  ring.push(ring[0])
  return ring
}

// 沿带时间戳的轨迹，找距城市最近的点 → 预计影响时间
export function cityImpact(track, city, thresholdKm = 300) {
  let best = null
  for (const p of track) {
    const d = haversine(p.coord, city.coord)
    if (!best || d < best.dist) best = { dist: d, time: p.time, point: p }
  }
  if (!best || best.dist > thresholdKm) return null
  return best
}

export function fmtCountdown(ms) {
  if (ms <= 0) return '正在影响'
  const h = Math.floor(ms / 3.6e6)
  const m = Math.floor((ms % 3.6e6) / 6e4)
  if (h >= 48) return `约 ${Math.round(h / 24)} 天后`
  return `${h}小时${String(m).padStart(2, '0')}分`
}

export function fmtTime(t) {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
