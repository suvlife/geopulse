import { useEffect, useRef, useState, useCallback } from 'react'
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js'

// CelesTrak TLE 分组,每 2 小时拉取一次
const GROUPS = [
  { key: 'stations', label: '空间站', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle' },
  { key: 'starlink', label: 'Starlink', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle' },
  { key: 'gps', label: 'GPS', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle' },
  { key: 'active', label: '活跃卫星', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle' },
]

const TLE_REFRESH = 2 * 3600e3 // 2 小时
const STARLINK_MAX = 1800 // Starlink 抽样上限(视觉足够,性能可控)

function parseTLE(text) {
  const lines = text.split('\n')
  const recs = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim()
    const l1 = lines[i + 1].trim()
    const l2 = lines[i + 2].trim()
    if (!name || !l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
    try {
      const satrec = twoline2satrec(l1, l2)
      if (!satrec) continue
      recs.push({ name, satrec })
    } catch { /* 坏 TLE 行跳过 */ }
  }
  return recs
}

// 分类:根据 NORAD ID 分配组
const STARLINK_RANGES = [
  [44000, 60000],
  [62000, 90000],
]

function classify(noradId) {
  const id = parseInt(noradId, 10)
  if (isNaN(id)) return 'other'
  if (id === 25544) return 'station'
  for (const [lo, hi] of STARLINK_RANGES) {
    if (id >= lo && id <= hi) return 'starlink'
  }
  if (id >= 20000 && id <= 50000) return 'gps'
  return 'active'
}

// 抽样:Starlink 太多,按 NORAD ID 哈希保留固定比例
function sample(recs, max) {
  if (recs.length <= max) return recs
  const out = []
  const step = recs.length / max
  for (let i = 0; i < max; i++) {
    const idx = Math.floor(i * step)
    out.push(recs[idx])
  }
  return out
}

function propagateFrame(recs, time) {
  const gmst = gstime(time)
  const out = []
  for (const rec of recs) {
    const pv = propagate(rec.satrec, time)
    if (!pv.position) continue
    const geo = eciToGeodetic(pv.position, gmst)
    const norad = rec.satrec.satnum
    out.push({
      id: String(norad),
      name: rec.name,
      norad: String(norad),
      lon: degreesLong(geo.longitude),
      lat: degreesLat(geo.latitude),
      alt: geo.height * 1000,
      group: classify(norad),
    })
  }
  return out
}

export function useSatellites(enabled) {
  const [satellites, setSatellites] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [groups, setGroups] = useState({ stations: true, starlink: true, gps: true, active: false })
  const cacheRef = useRef({ tle: {}, lastFetch: 0, recs: [] })

  // 拉取 TLE
  const loadTLE = useCallback(async (wantedGroups) => {
    const now = Date.now()
    const cache = cacheRef.current
    const needFetch = wantedGroups.filter((g) => !cache.tle[g])
    if (needFetch.length === 0 && now - cache.lastFetch < TLE_REFRESH) return

    setLoading(true)
    const results = {}
    let anyNew = false
    for (const g of GROUPS) {
      if (!wantedGroups.includes(g.key)) continue
      if (cache.tle[g.key] && now - cache.lastFetch < TLE_REFRESH) {
        results[g.key] = cache.tle[g.key]
        continue
      }
      try {
        const r = await fetch(g.url, { signal: AbortSignal.timeout(30000) })
        if (!r.ok) throw new Error(`${r.status}`)
        const text = await r.text()
        const recs = parseTLE(text)
        // Starlink 抽样,其他组保留全部
        const sampled = g.key === 'starlink' ? sample(recs, STARLINK_MAX) : recs
        results[g.key] = { recs: sampled, groupKey: g.key }
        anyNew = true
      } catch (e) {
        if (cache.tle[g.key]) results[g.key] = cache.tle[g.key]
      }
    }
    setLoading(false)
    if (!Object.keys(results).length) {
      setError('all TLE sources failed')
      return
    }
    if (anyNew) {
      cache.tle = { ...cache.tle, ...results }
      cache.lastFetch = now
      // 合并所有启用分组的卫星,去重
      const seen = new Set()
      const merged = []
      for (const g of wantedGroups) {
        const tle = cache.tle[g]
        if (!tle) continue
        for (const r of tle.recs) {
          if (seen.has(r.name)) continue
          seen.add(r.name)
          merged.push(r)
        }
      }
      cache.recs = merged
    }
    setError(null)
    setUpdatedAt(now)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const wanted = Object.entries(groups).filter(([, v]) => v).map(([k]) => k)
    loadTLE(wanted)
    const t = setInterval(() => loadTLE(wanted), TLE_REFRESH)
    return () => clearInterval(t)
  }, [enabled, groups, loadTLE])

  // 动画循环:逐帧 SGP4 推算,60fps 连续运动
  useEffect(() => {
    if (!enabled) return
    const cache = cacheRef.current
    let raf
    let last = 0

    const tick = (t) => {
      if (t - last > 33) { // 上限 30fps,给 UI 留余量
        last = t
        if (cache.recs.length) {
          const frame = propagateFrame(cache.recs, new Date())
          setSatellites(frame)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled])

  const refresh = () => {
    cacheRef.current.lastFetch = 0
    const wanted = Object.entries(groups).filter(([, v]) => v).map(([k]) => k)
    loadTLE(wanted)
  }

  return { satellites, loading, error, updatedAt, groups, setGroups, refresh }
}
