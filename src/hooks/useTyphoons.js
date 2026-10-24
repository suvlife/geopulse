import { useEffect, useRef, useState, useCallback } from 'react'
import { windToCat } from '../utils/scales.js'
import { buildSampleTyphoon } from '../data/sampleTyphoon.js'

// istrongcloud 年度文件(active.json 已下线);直连优先,Worker 代理兜底
// 跨年兜底:1 月时当年文件尚不存在,回看上一年
const API = 'https://geopulse-api.guofeng.me'
const DIRECT = 'https://data.istrongcloud.com/v2/data/complex'

function listUrls(year = new Date().getFullYear()) {
  return [
    `${DIRECT}/${year}.json`,
    `${API}/typhoon/list?year=${year}`,
  ]
}

// 列表:当年文件可能"请求成功但数组为空"(年初无台风/休渔期),
// 空数组不能当作成功直接返回,否则永远回看不到上一年,页面会错误降级演示数据
export async function fetchList(signal) {
  const y = new Date().getFullYear()
  let lastErr
  for (const year of [y, y - 1]) {
    try {
      const list = await fetchFirst(listUrls(year), signal)
      const all = (Array.isArray(list) ? list : []).filter((t) => t.tfbh || t.ident)
      if (all.length) return all
    } catch (e) {
      if (signal?.aborted) throw e
      lastErr = e
    }
  }
  throw lastErr || new Error('empty-list')
}

const detailUrls = (id) => [
  `${DIRECT}/${id}.json`,
  `${API}/typhoon/detail?id=${id}`,
]

const AGENCY_MAP = {
  中国: 'CMA', 中央气象台: 'CMA',
  日本: 'JMA',
  美国: 'JTWC',
  中国香港: 'HKO',
  韩国: 'KMA',
  中国台湾: 'CWA',
  欧洲: 'ECMWF', 欧洲中期: 'ECMWF',
}

// 给 fetch 同时加外部取消信号与超时
function abortAfter(signal, ms) {
  const timeout = AbortSignal.timeout(ms)
  if (!signal) return timeout
  return AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal
}

async function fetchFirst(urls, signal, timeout = 10000) {
  let lastErr
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: abortAfter(signal, timeout) })
      if (!r.ok) throw new Error(`${r.status}`)
      return await r.json()
    } catch (e) {
      if (signal?.aborted) throw e
      lastErr = e
    }
  }
  throw lastErr || new Error('all sources failed')
}

export function parseTime(s) {
  if (typeof s === 'number') return s < 1e12 ? s * 1000 : s // 兼容秒级时间戳
  const str = String(s || '').trim()
  if (!str) return NaN
  // 已带 Z / 时区偏移的时间不再追加 +08:00
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str.replace(' ', 'T')).getTime()
  return new Date(`${str.replace(' ', 'T')}+08:00`).getTime()
}

// 风圈:优先 *_quad 四象限对象 {ne,se,sw,nw},退化为等半径
export function parseRadii(quad, single) {
  if (quad && typeof quad === 'object') {
    const { ne, se, sw, nw } = quad
    if (ne || se || sw || nw) return { ne: +ne || 0, se: +se || 0, sw: +sw || 0, nw: +nw || 0 }
  }
  const r = Number(single)
  if (r > 0) return { ne: r, se: r, sw: r, nw: r }
  return null
}

export function parseCat(strong, wind) {
  if (strong) {
    const m = String(strong).match(/\((\w+)\)/)
    if (m) {
      const code = m[1]
      if (code === 'SuperTY' || code === 'Super TY') return 'SuperTY'
      if (['TD', 'TS', 'STS', 'TY', 'STY'].includes(code)) return code
    }
    if (/超强台风/.test(strong)) return 'SuperTY'
    if (/强台风/.test(strong)) return 'STY'
    if (/^台风/.test(strong)) return 'TY'
    if (/强热带风暴/.test(strong)) return 'STS'
    if (/热带风暴/.test(strong)) return 'TS'
    if (/热带低压/.test(strong)) return 'TD'
  }
  return windToCat(wind || 0)
}

// 编号显示:202631 → 第 31 号(取后两位)
export function displayNo(id) {
  const digits = String(id || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length > 4 ? digits.slice(-2) : digits
}

function normalize(raw) {
  const obj = Array.isArray(raw) ? raw[0] : raw
  if (!obj?.points?.length) return null
  const track = obj.points.map((p) => {
    const wind = Number(p.speed) || 0
    return {
      time: parseTime(p.time),
      coord: [Number(p.lng), Number(p.lat)],
      wind,
      pressure: Number(p.pressure) || null,
      power: Number(p.power) || null,
      moveSpeed: Number(p.move_speed ?? p.movespeed) || null,
      moveDir: p.move_dir ?? p.movedirection ?? '',
      cat: parseCat(p.strong, wind),
      r7: parseRadii(p.radius7_quad, p.radius7),
      r10: parseRadii(p.radius10_quad, p.radius10),
      r12: parseRadii(p.radius12_quad, p.radius12),
    }
  }).filter((p) => Number.isFinite(p.time) && Number.isFinite(p.coord[0]) && Number.isFinite(p.coord[1]))

  // 预报分散在最近若干个观测点上:从最新点向前扫描,按机构各取一份最新的,
  // 避免旧逻辑只读“最后一个带 forecast 的点”导致大部分机构预报丢失
  const forecasts = {}
  const points = obj.points
  const scanFrom = Math.max(0, points.length - 8)
  for (let i = points.length - 1; i >= scanFrom; i--) {
    const fc = points[i].forecast
    if (!Array.isArray(fc)) continue
    for (const f of fc) {
      const agency = AGENCY_MAP[f.sets ?? f.tm] || f.sets || f.tm || '其他'
      if (forecasts[agency]?.length) continue // 已取到更新的同机构预报
      const pts = (f.points || f.forecastpoints || [])
        .map((p) => {
          const wind = Number(p.speed) || 0
          return {
            time: parseTime(p.time),
            coord: [Number(p.lng), Number(p.lat)],
            wind,
            pressure: Number(p.pressure) || null,
            cat: parseCat(p.strong, wind),
            agency,
          }
        })
        .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.coord[0]) && Number.isFinite(p.coord[1]))
      if (pts.length) forecasts[agency] = pts.sort((a, b) => a.time - b.time)
    }
  }

  const id = String(obj.tfbh ?? obj.ident ?? obj.id)
  return {
    id,
    name: obj.name || obj.ename,
    enname: obj.ename || '',
    no: displayNo(id),
    active: obj.is_current === 1,
    endTime: obj.end_time || obj.endTime || '',
    track: track.sort((a, b) => a.time - b.time),
    forecasts,
  }
}

export function useTyphoons() {
  const [state, setState] = useState({
    typhoons: [],
    source: 'loading', // 'live' | 'history' | 'sample' | 'loading'
    error: null,
    updatedAt: null,
  })
  const seqRef = useRef(0)
  const ctrlRef = useRef(null)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl

    try {
      const all = await fetchList(ctrl.signal)
      if (seq !== seqRef.current) return

      // 活跃台风优先;都结束了则按编号/结束时间取最近 2 个供回看
      const current = all.filter((t) => t.is_current === 1)
      const sorted = [...all].sort((a, b) => {
        const ea = String(a.end_time || ''), eb = String(b.end_time || '')
        if (ea !== eb) return eb.localeCompare(ea)
        return String(b.tfbh ?? b.ident).localeCompare(String(a.tfbh ?? a.ident))
      })
      const wanted = current.length ? current : sorted.slice(0, 2)

      const details = await Promise.all(
        wanted.slice(0, 4).map(async (t) => {
          try {
            // 详情接口偶尔很慢(数秒到十几秒):6s 拿不到就换下一个台风,别拖住首屏
            return normalize(await fetchFirst(detailUrls(t.tfbh ?? t.ident), ctrl.signal, 6000))
          } catch { return null }
        })
      )
      if (seq !== seqRef.current) return
      const typhoons = details.filter(Boolean)
      if (!typhoons.length) throw new Error('no-detail')
      setState({ typhoons, source: current.length ? 'live' : 'history', error: null, updatedAt: Date.now() })
    } catch (e) {
      if (seq !== seqRef.current || e.name === 'AbortError') return
      // 定时刷新失败时保留上一份真实数据(只有首次失败才降级演示数据)
      setState((s) => {
        if (s.typhoons.length && s.source !== 'sample') {
          return { ...s, error: e.message }
        }
        return {
          typhoons: [buildSampleTyphoon()],
          source: 'sample',
          error: e.message,
          updatedAt: Date.now(),
        }
      })
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 300000) // 5 分钟自动刷新
    return () => {
      clearInterval(t)
      ctrlRef.current?.abort()
    }
  }, [load])

  return { ...state, refresh: load }
}
