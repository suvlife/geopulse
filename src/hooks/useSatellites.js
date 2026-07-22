import { useEffect, useRef, useState, useCallback } from 'react'
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js'

// 快照方案:构建时 scripts/fetch-tle.mjs 拉取到 /data/,随静态站分发(零 CORS 零限流)
// CelesTrak gp.php 对浏览器高频 Origin 请求 403、对 CF 出口 IP 超时,不可直连
const FULL_URLS = ['/data/active.tle', 'https://geopulse-api.guofeng.me/tle?group=active']
const SATCAT_URLS = ['/data/satcat.csv', 'https://geopulse-api.guofeng.me/satcat']

const TLE_REFRESH = 2 * 3600e3
const PROP_INTERVAL = 400
const PANEL_INTERVAL = 2000

// 按名称归类(CelesTrak 命名规则)
const NAME_RULES = [
  ['starlink', /^STARLINK/i],
  ['oneweb', /^ONEWEB/i],
  ['stations', /^(ISS|CSS|TIANGONG|TIANHE|WENTIAN|MENGTIAN|AXIOM)/i],
  ['gps', /^(NAVSTAR|GPS BI|USA-\d)/i],
  ['beidou', /^(BEIDOU|BDS)/i],
  ['glonass', /GLONASS|COSMOS \d+ \(GLONASS/i],
  ['galileo', /^(GSAT|GALILEO)/i],
  ['iridium', /^IRIDIUM/i],
  ['weather', /^(NOAA|GOES|METOP|METEOR|HIMAWARI|FENGYUN|FY-|DMSP|GMS|MTSAT|INSAT|KALPANA|GEONETCAST|SUOMI|JPSS|EWS-G|ELEKTRO|GEO-KOMPSAT|METEOSAT|TERRA|AQUA)/i],
]

function classify(name) {
  for (const [group, re] of NAME_RULES) {
    if (re.test(name)) return group
  }
  return 'others'
}

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
      if (satrec) recs.push({ name, satrec })
    } catch { /* 坏行跳过 */ }
  }
  return recs
}

function parseSatcat(text) {
  const lines = text.split('\n')
  const map = new Map()
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l) continue
    const c = l.split(',')
    const norad = c[2]?.trim()
    if (!norad || !/^\d+$/.test(norad)) continue
    map.set(norad, {
      name: c[0], type: c[3], status: c[4], owner: c[5], launch: c[6],
      period: parseFloat(c[9]) || null,
      inclination: parseFloat(c[10]) || null,
      apogee: parseFloat(c[11]) || null,
      perigee: parseFloat(c[12]) || null,
    })
  }
  return map
}

async function fetchText(url, timeout = 60000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.text()
}

async function fetchFirstText(urls) {
  let lastErr
  for (const u of urls) {
    try {
      return await fetchText(u)
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('all sources failed')
}

export function useSatellites(enabled) {
  const [satellites, setSatellites] = useState([])
  const [satinfo, setSatinfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [visibleGroups, setVisibleGroups] = useState({
    starlink: true, oneweb: true, stations: true, gps: true,
    beidou: true, glonass: true, galileo: true, iridium: true,
    weather: true, others: true,
  })
  const [speed, setSpeed] = useState(1)

  const dataRef = useRef({
    recs: [], lastFetch: 0, satcat: null,
    prevFrame: null, prevTime: 0, currFrame: null, currTime: 0,
  })
  const positionsRef = useRef([])
  const frameRef = useRef(0)
  const simRef = useRef({ time: Date.now(), speed: 1, lastReal: 0 })

  const loadAll = useCallback(async (force = false) => {
    const cache = dataRef.current
    const now = Date.now()
    if (!force && cache.recs.length && now - cache.lastFetch < TLE_REFRESH) return
    if (cache._loading) return
    cache._loading = true

    setLoading(true)
    setError(null)
    setProgress(0)
    try {
      // 1) 全量 TLE(本地快照 → Worker 代理)
      const fullText = await fetchFirstText(FULL_URLS)
      setProgress(0.5)
      const all = parseTLE(fullText)

      // 2) SATCAT(失败不阻塞)
      let satcat = cache.satcat
      if (!satcat) {
        try {
          satcat = parseSatcat(await fetchFirstText(SATCAT_URLS))
          cache.satcat = satcat
        } catch { /* SATCAT 可选 */ }
      }
      setSatinfo(satcat)
      setProgress(0.85)

      const recs = all.map((r) => {
        const norad = String(r.satrec.satnum)
        return {
          id: norad,
          name: r.name,
          norad,
          group: classify(r.name),
          satrec: r.satrec,
          lon: 0, lat: 0, alt: 0,
        }
      })
      cache.recs = recs
      cache.lastFetch = now
      cache.currFrame = null
      positionsRef.current = recs
      setProgress(1)
      setUpdatedAt(now)
    } catch (e) {
      setError(e.message)
    } finally {
      cache._loading = false
      setLoading(false)
      setTimeout(() => setProgress(0), 600)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    loadAll()
    const t = setInterval(() => loadAll(), TLE_REFRESH)
    return () => clearInterval(t)
  }, [enabled, loadAll])

  // 主推算循环
  useEffect(() => {
    if (!enabled) return
    const cache = dataRef.current
    const sim = simRef.current
    let raf, lastProp = 0, lastPanel = 0

    const tick = (realNow) => {
      if (sim.lastReal) sim.time += (realNow - sim.lastReal) * sim.speed
      sim.lastReal = realNow

      const n = cache.recs.length
      if (n) {
        if (realNow - lastProp >= PROP_INTERVAL || !cache.currFrame) {
          lastProp = realNow
          cache.prevFrame = cache.currFrame
          cache.prevTime = cache.currTime
          const frame = new Float32Array(n * 3)
          const t = new Date(sim.time)
          const gmst = gstime(t)
          for (let i = 0; i < n; i++) {
            try {
              const pv = propagate(cache.recs[i].satrec, t)
              if (pv && pv.position) {
                const geo = eciToGeodetic(pv.position, gmst)
                frame[i * 3] = degreesLong(geo.longitude)
                frame[i * 3 + 1] = degreesLat(geo.latitude)
                frame[i * 3 + 2] = geo.height * 1000
              } else {
                frame[i * 3 + 2] = -1e9
              }
            } catch {
              frame[i * 3 + 2] = -1e9
            }
          }
          cache.currFrame = frame
          cache.currTime = realNow
        }

        const { prevFrame, prevTime, currFrame, currTime } = cache
        let alpha = 1
        if (prevFrame && currTime > prevTime) {
          alpha = Math.min(1, Math.max(0, (realNow - prevTime) / (currTime - prevTime)))
        }
        const recs = cache.recs
        for (let i = 0; i < n; i++) {
          const rec = recs[i]
          const ci = i * 3
          const cx = currFrame[ci], cy = currFrame[ci + 1], cz = currFrame[ci + 2]
          if (cz < -1e8) { rec.alt = -1; continue }
          if (prevFrame && prevFrame[ci + 2] > -1e8) {
            let d = cx - prevFrame[ci]
            if (d > 180) d -= 360
            if (d < -180) d += 360
            let lon = prevFrame[ci] + d * alpha
            if (lon > 180) lon -= 360
            if (lon < -180) lon += 360
            rec.lon = lon
            rec.lat = prevFrame[ci + 1] + (cy - prevFrame[ci + 1]) * alpha
            rec.alt = prevFrame[ci + 2] + (cz - prevFrame[ci + 2]) * alpha
          } else {
            rec.lon = cx
            rec.lat = cy
            rec.alt = cz
          }
        }
        frameRef.current++

        if (realNow - lastPanel >= PANEL_INTERVAL) {
          lastPanel = realNow
          setSatellites(recs.filter((r) => r.alt > 0))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled])

  const setTimeSpeed = useCallback((s) => {
    simRef.current.speed = s
    setSpeed(s)
  }, [])
  const resetTime = useCallback(() => {
    simRef.current.time = Date.now()
  }, [])

  const getOrbitPath = useCallback((sat, points = 120) => {
    const rec = dataRef.current.recs.find((r) => r.norad === sat.norad)
    if (!rec) return []
    const t0 = simRef.current.time
    const periodMs = rec.satrec.no ? (2 * Math.PI / rec.satrec.no) * 60000 : 90 * 60000
    const path = []
    for (let i = 0; i <= points; i++) {
      const t = new Date(t0 + (i / points) * periodMs)
      const pv = propagate(rec.satrec, t)
      if (!pv.position) continue
      const geo = eciToGeodetic(pv.position, gstime(t))
      path.push([degreesLong(geo.longitude), degreesLat(geo.latitude), geo.height * 1000])
    }
    return path
  }, [])

  const refresh = () => loadAll(true)

  return {
    satellites, satinfo, loading, progress, error, updatedAt,
    visibleGroups, setVisibleGroups,
    speed, setTimeSpeed, resetTime,
    simTimeRef: simRef, positionsRef, frameRef,
    getOrbitPath,
    refresh,
  }
}
