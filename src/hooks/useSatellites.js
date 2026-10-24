import { useEffect, useRef, useState, useCallback } from 'react'
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js'

// 快照方案:构建时 scripts/fetch-tle.mjs 拉取到 /data/,随静态站分发(零 CORS 零限流)
// CelesTrak gp.php 对浏览器高频 Origin 请求 403、对 CF 出口 IP 超时,不可直连
const FULL_URLS = ['/data/active.tle', 'https://geopulse-api.guofeng.me/tle?group=active']
const SATCAT_URLS = ['/data/satcat.csv', 'https://geopulse-api.guofeng.me/satcat']

const TLE_REFRESH = 2 * 3600e3
const PROP_INTERVAL = 1000 // 全量 SGP4 每秒一次,帧间线性插值;400ms 时 1.6 万颗 ≈ 50ms/次
const PANEL_INTERVAL = 2000
const TLE_FRESH_MS = 6 * 3600e3 // 6h 内视为新鲜,不再请求 Worker
const TLE_WARN_MS = 24 * 3600e3 // 超过 24h 标记“非实时”
const TLE_EXPIRE_MS = 7 * 24 * 3600e3 // 超过 7 天视为过期

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

// TLE 第 1 行第 19-32 列 = 纪元(YYDDD.DDDDDDDD)
export function tleEpochMs(l1) {
  const yy = parseInt(l1.slice(18, 20), 10)
  const doy = parseFloat(l1.slice(20, 32))
  if (!Number.isFinite(yy) || !Number.isFinite(doy)) return NaN
  const year = yy < 57 ? 2000 + yy : 1900 + yy
  return Date.UTC(year, 0, 1) + (doy - 1) * 864e5
}

export function parseTLE(text) {
  const lines = text.split('\n')
  const recs = []
  let epochMax = 0
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim()
    const l1 = lines[i + 1].trim()
    const l2 = lines[i + 2].trim()
    if (!name || !l1.startsWith('1 ') || !l2.startsWith('2 ')) continue
    if (l1.length < 69 || l2.length < 69) continue // 截断的 TLE 直接跳过
    try {
      const satrec = twoline2satrec(l1, l2)
      // satellite.js 对坏数据不抛异常,而是把错误码放在 satrec.error
      if (!satrec || satrec.error) continue
      const ep = tleEpochMs(l1)
      if (Number.isFinite(ep) && ep > epochMax) epochMax = ep
      recs.push({ name, satrec })
    } catch { /* 坏行跳过 */ }
  }
  return { recs, epochMax }
}

export function parseSatcat(text) {
  const lines = text.split('\n')
  const map = new Map()
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l) continue
    const c = l.split(',')
    const norad = c[2]?.trim()
    if (!norad || !/^\d+$/.test(norad)) continue
    // 去掉前导零(TLE 里是 00900,SATCAT 是 900),否则 13 颗卫星查不到档案
    map.set(String(Number(norad)), {
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
  const [tleAge, setTleAge] = useState(null)
  const [visibleGroups, setVisibleGroups] = useState({
    starlink: true, oneweb: true, stations: true, gps: true,
    beidou: true, glonass: true, galileo: true, iridium: true,
    weather: true, others: true,
  })
  const [speed, setSpeed] = useState(1)

  const dataRef = useRef({
    recs: [], lastFetch: 0, satcat: null,
    prevFrame: null, prevTime: 0, currFrame: null, currTime: 0, propSimTime: 0,
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
      // 1) 全量 TLE:本地快照优先,但必须按 TLE 纪元判断新鲜度
      //    (CI checkout 会把文件 mtime 设为当前时间,只看 mtime 会永远用旧快照)
      let best = null
      const tryText = async (url, timeout) => {
        try {
          const text = await fetchText(url, timeout)
          const parsed = parseTLE(text)
          return parsed.recs.length >= 1000 ? { text, ...parsed } : null
        } catch { return null }
      }
      const local = await tryText(FULL_URLS[0], 30000)
      best = local
      if (!local || now - local.epochMax > TLE_FRESH_MS) {
        // 本地过期 → 尝试 Worker 实时代理,取纪元更新的那份
        const proxied = await tryText(FULL_URLS[1], 20000)
        if (proxied && (!best || proxied.epochMax > best.epochMax)) best = proxied
      }
      if (!best) throw new Error('TLE 不可用(本地快照缺失且 Worker 代理失败)')
      setProgress(0.5)

      // 2) SATCAT 档案:延迟到空闲时加载,不阻塞首屏
      if (!cache.satcat && !cache._satcatLoading) {
        cache._satcatLoading = true
        const runSatcat = async () => {
          try {
            const m = parseSatcat(await fetchFirstText(SATCAT_URLS))
            cache.satcat = m
            setSatinfo(m)
          } catch { cache._satcatLoading = false }
        }
        if (typeof window !== 'undefined' && window.requestIdleCallback) {
          window.requestIdleCallback(runSatcat, { timeout: 8000 })
        } else {
          setTimeout(runSatcat, 4000)
        }
      }
      setProgress(0.85)

      const recs = best.recs.map((r) => {
        // TLE 的 satnum 固定 5 位带前导零,SATCAT/DOM 查询需去掉
        const norad = String(Number(r.satrec.satnum))
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
      cache.propSimTime = 0
      positionsRef.current = recs
      // 本机时钟可能落后于 TLE 纪元(时区/校时异常),负数按 0 处理,避免出现“-3 分钟前”
      setTleAge(Math.max(0, now - best.epochMax))
      setUpdatedAt(best.epochMax)
      setProgress(1)
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
    // 首次进入时把仿真时间对齐到当前真实时间(否则沿用上次挂载的时间,LEO 会偏几分钟)
    sim.time = Date.now()
    sim.lastReal = 0
    let raf, lastProp = 0, lastPanel = 0

    const tick = (realNow) => {
      if (sim.lastReal) sim.time += (realNow - sim.lastReal) * sim.speed
      sim.lastReal = realNow

      const n = cache.recs.length
      if (n) {
        const timeChanged = Math.abs(sim.time - cache.propSimTime) > 1
        if (!cache.currFrame || (timeChanged && realNow - lastProp >= PROP_INTERVAL)) {
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
          cache.propSimTime = sim.time
        }

        // 暂停时不插值、不推进帧计数,渲染管线可以完全空闲
        if (sim.speed === 0 && cache.currFrame) {
          raf = requestAnimationFrame(tick)
          return
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
    let prevLon = null
    for (let i = 0; i <= points; i++) {
      const t = new Date(t0 + (i / points) * periodMs)
      const pv = propagate(rec.satrec, t)
      if (!pv || !pv.position) continue
      const geo = eciToGeodetic(pv.position, gstime(t))
      let lon = degreesLong(geo.longitude)
      // 经度连续化:消除 ±180° 跳变,否则 deck.gl 会画出横穿地球的直线
      if (prevLon != null) {
        while (lon - prevLon > 180) lon -= 360
        while (lon - prevLon < -180) lon += 360
      }
      prevLon = lon
      path.push([lon, degreesLat(geo.latitude), geo.height * 1000])
    }
    return path
  }, [])

  const refresh = () => loadAll(true)

  return {
    satellites, satinfo, loading, progress, error, updatedAt,
    tleAge, tleWarn: tleAge != null && tleAge > TLE_WARN_MS, tleExpired: tleAge != null && tleAge > TLE_EXPIRE_MS,
    visibleGroups, setVisibleGroups,
    speed, setTimeSpeed, resetTime,
    simTimeRef: simRef, positionsRef, frameRef,
    getOrbitPath,
    refresh,
  }
}
