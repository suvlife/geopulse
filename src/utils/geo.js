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
// radii: { ne, se, sw, nw }。AIS/台风资料里四象限就是四个扇区,
// 扇区内半径恒定,不能做象限间线性插值(会把 500/100 的东北/东南风圈画小一半)
export function windQuadPolygon(center, radii, stepsPerQuad = 16) {
  const quads = [radii.ne, radii.se, radii.sw, radii.nw]
  const ring = []
  for (let q = 0; q < 4; q++) {
    for (let i = 0; i < stepsPerQuad; i++) {
      const bearing = q * 90 + (i / stepsPerQuad) * 90
      ring.push(destPoint(center, bearing, quads[q]))
    }
  }
  ring.push(ring[0])
  return ring
}

// 沿带时间戳的轨迹，找距城市最近的线段 → 预计影响时间(线段内插值,比只比离散点精确)
export function cityImpact(track, city, thresholdKm = 300) {
  if (!track?.length) return null
  if (track.length === 1) {
    const d = haversine(track[0].coord, city.coord)
    return d <= thresholdKm ? { dist: d, time: track[0].time, point: track[0] } : null
  }
  let best = null
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]
    const b = track[i]
    const k = Math.cos(rad((a.coord[1] + b.coord[1]) / 2))
    const ax = a.coord[0] * k, ay = a.coord[1]
    const bx = b.coord[0] * k, by = b.coord[1]
    const px = city.coord[0] * k, py = city.coord[1]
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    const p = [a.coord[0] + (b.coord[0] - a.coord[0]) * t, a.coord[1] + (b.coord[1] - a.coord[1]) * t]
    const d = haversine(p, city.coord)
    if (!best || d < best.dist) {
      best = { dist: d, time: a.time + (b.time - a.time) * t, point: a }
    }
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

// 统一按北京时间显示,避免海外用户看到“本地时区”的错位时间
const BJ_FMT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

export function fmtTime(t) {
  if (!Number.isFinite(t)) return '—'
  const parts = {}
  for (const p of BJ_FMT.formatToParts(new Date(t))) parts[p.type] = p.value
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}
