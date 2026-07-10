import { useEffect, useState, useCallback } from 'react'
import { windToCat } from '../utils/scales.js'
import { buildSampleTyphoon } from '../data/sampleTyphoon.js'

// istrongcloud 年度文件(active.json 已下线);直连优先,Worker 代理兜底
const YEAR = new Date().getFullYear()
const LIST_URLS = [
  `https://data.istrongcloud.com/v2/data/complex/${YEAR}.json`,
  'https://geopulse-api.guofeng.me/typhoon/list',
]
const DETAIL_URLS = (id) => [
  `https://data.istrongcloud.com/v2/data/complex/${id}.json`,
  `https://geopulse-api.guofeng.me/typhoon/detail?id=${id}`,
]

const AGENCY_MAP = { 中国: 'CMA', 中央气象台: 'CMA', 日本: 'JMA', 美国: 'JTWC', 中国香港: 'HKO', 韩国: 'KMA', 中国台湾: 'CWA' }

async function fetchFirst(urls) {
  let lastErr
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) })
      if (!r.ok) throw new Error(`${r.status}`)
      return await r.json()
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('all sources failed')
}

function parseTime(s) {
  if (typeof s === 'number') return s
  return new Date(String(s).replace(' ', 'T') + '+08:00').getTime()
}

// 风圈:优先 *_quad 四象限对象 {ne,se,sw,nw},退化为等半径
function parseRadii(quad, single) {
  if (quad && typeof quad === 'object') {
    const { ne, se, sw, nw } = quad
    if (ne || se || sw || nw) return { ne: +ne || 0, se: +se || 0, sw: +sw || 0, nw: +nw || 0 }
  }
  const r = Number(single)
  if (r > 0) return { ne: r, se: r, sw: r, nw: r }
  return null
}

function parseCat(strong, wind) {
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
  })
  // 预报挂在最后一个带 forecast 的观测点;机构名在 sets 字段
  let fcRaw = []
  for (let i = obj.points.length - 1; i >= 0; i--) {
    if (obj.points[i].forecast?.length) { fcRaw = obj.points[i].forecast; break }
  }
  const forecasts = {}
  for (const f of fcRaw) {
    const agency = AGENCY_MAP[f.sets ?? f.tm] || f.sets || f.tm || '其他'
    const pts = (f.points || f.forecastpoints || []).map((p) => {
      const wind = Number(p.speed) || 0
      return {
        time: parseTime(p.time),
        coord: [Number(p.lng), Number(p.lat)],
        wind,
        pressure: Number(p.pressure) || null,
        cat: parseCat(p.strong, wind),
      }
    })
    if (pts.length) forecasts[agency] = pts
  }
  return {
    id: String(obj.tfbh ?? obj.ident ?? obj.id),
    name: obj.name || obj.ename,
    enname: obj.ename || '',
    no: String(obj.tfbh ?? obj.ident ?? '').slice(-4),
    active: obj.is_current === 1,
    track,
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

  const load = useCallback(async () => {
    try {
      const list = await fetchFirst(LIST_URLS)
      const all = (Array.isArray(list) ? list : []).filter((t) => t.tfbh || t.ident)
      if (!all.length) throw new Error('empty-list')
      // 活跃台风优先;都结束了则取最近 2 个供回看
      const current = all.filter((t) => t.is_current === 1)
      const wanted = current.length ? current : all.slice(0, 2)
      const details = await Promise.all(
        wanted.slice(0, 4).map(async (t) => {
          try {
            return normalize(await fetchFirst(DETAIL_URLS(t.tfbh ?? t.ident)))
          } catch { return null }
        })
      )
      const typhoons = details.filter(Boolean)
      if (!typhoons.length) throw new Error('no-detail')
      setState({ typhoons, source: current.length ? 'live' : 'history', error: null, updatedAt: Date.now() })
    } catch (e) {
      // 数据源全部不可达 → 演示数据兜底,页面始终可用
      setState({
        typhoons: [buildSampleTyphoon()],
        source: 'sample',
        error: e.message,
        updatedAt: Date.now(),
      })
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 300000) // 5 分钟自动刷新
    return () => clearInterval(t)
  }, [load])

  return { ...state, refresh: load }
}
