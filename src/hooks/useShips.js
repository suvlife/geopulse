import { useCallback, useEffect, useRef, useState } from 'react'
import { generateShips, advanceShips } from '../utils/shipSim.js'
import { mmsiCountry } from '../data/shipData.js'

// 数据模式:'demo'(模拟航道演示) | 'live'(真实 AIS,经 Worker 代理)
// aisstream 免费账号禁止浏览器直连/在客户端保存 Key;
// Worker 的 Durable Object 复用一条上游连接,Key 只存在于 Worker secret
const AIS_WS_URL = 'wss://geopulse-api.guofeng.me/ais'
const MAX_SHIPS = 4000
const STALE_MS = 30 * 60e3
const DECODER = new TextDecoder() // 每条消息复用,避免高频分配
const POS_TYPES = new Set(['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'])
const MAX_PENDING_STATIC = 3000

// AIS 文本字段常用 '@' 填充,需要去掉
export function nameClean(s) {
  return String(s || '').replace(/@/g, '').trim()
}

// 把静态字段合并进船舶对象;空字段不覆盖已有值
function applyStatic(ship, st) {
  if (!st) return
  if (st.name) ship.name = st.name
  if (st.type && st.type !== 'other') ship.type = st.type
  if (st.dest) ship.dest = st.dest
  if (st.imo) ship.imo = st.imo
  if (st.callsign) ship.callsign = st.callsign
  if (st.length) ship.length = st.length
  if (st.country) ship.country = st.country
}

// AIS 船型码 → 我们的船型分类(AIS 标准:70-79 货船,80-89 油轮,60-69 客船,30 渔船)
// 集装箱船 AIS 用 70-79,但 aisstream MetaData.ShipType 常缺失,此时从 ShipStaticData.Type 补
export function aisShipType(code) {
  const c = Number(code)
  if (c >= 80 && c < 90) return 'tanker'
  if (c >= 70 && c < 80) return 'cargo'
  if (c >= 60 && c < 70) return 'passenger'
  if (c === 30) return 'fishing'
  if (c === 31 || c === 32 || c === 52 || c === 53) return 'tug'
  if (c >= 40 && c < 50) return 'other' // 高速船
  if (c === 50 || c === 51) return 'other' // 引航船/搜救船
  if (c >= 33 && c < 37) return 'other' // 疏浚/军用
  return 'other' // 未知(等 ShipStaticData 补全,不要猜成货船)
}

export function useShips(enabled, bbox = null) {
  const [ships, setShips] = useState([])
  const [mode, setMode] = useState('connecting') // connecting | live | demo
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const shipsRef = useRef(new Map()) // mmsi → ship(Map 便于 AIS 实时更新)
  const pendingStaticRef = useRef(new Map()) // mmsi → 先到的静态信息(船名/船型等)
  const simRef = useRef({ time: Date.now(), speed: 60, lastReal: 0 })
  const frameRef = useRef(0)
  const wsRef = useRef(null)
  const ctrlRef = useRef(null)
  const retryRef = useRef(0)
  const reconnectRef = useRef(null)
  const bboxRef = useRef(bbox)
  bboxRef.current = bbox

  // 上报视野给 Worker 的 DO:下行只推视野内的船(World 视野传 null = 不过滤)
  const sendViewport = useCallback((ws) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      const b = bboxRef.current
      ws.send(JSON.stringify({ type: 'viewport', bbox: Array.isArray(b) ? b : null }))
    } catch { /* socket 已关闭 */ }
  }, [])

  // 演示船队兜底
  const initDemo = useCallback(() => {
    const demo = generateShips(400, 42)
    shipsRef.current = new Map(demo.map((s) => [String(s.mmsi), s]))
    setShips(demo)
    setMode('demo')
    setUpdatedAt(null)
  }, [])

  const rememberStatic = useCallback((mmsi, st) => {
    const m = pendingStaticRef.current
    m.set(mmsi, { ...(m.get(mmsi) || {}), ...st })
    // 缓存有上限:位置消息迟迟不来时按插入顺序淘汰
    if (m.size > MAX_PENDING_STATIC) m.delete(m.keys().next().value)
  }, [])

  // AIS 实时流
  useEffect(() => {
    if (!enabled) return
    // 用 ref 而非闭包变量,避免 StrictMode 双渲染时第二次 effect 拿到第一次的 stopped=true
    const ctrl = { stopped: false, retryTimer: null, ws: null }
    ctrlRef.current = ctrl

    const connect = () => {
      if (ctrl.stopped) return
      if (ctrl.ws && (ctrl.ws.readyState === WebSocket.OPEN || ctrl.ws.readyState === WebSocket.CONNECTING)) return
      setMode('connecting')
      setError(null)
      try {
        ctrl.ws = new WebSocket(AIS_WS_URL)
      } catch (e) {
        setError('WebSocket 不可用')
        initDemo()
        return
      }
      wsRef.current = ctrl.ws
      const ws = ctrl.ws

      ws.onopen = () => {
        // 握手成功 ≠ 有数据:DO 在上游 Key 失效时也会先完成握手。
        // 所以重连计数只在收到第一条消息时清零,否则 watchdog 关闭 → 重连 onopen 清零
        // → retryRef 永远到不了 6,演示数据兜底不可达。
        armWatchdog()
        sendViewport(ws)
        // 订阅由 Worker 的 DO 统一发往 aisstream,客户端无需(也没有)API Key
        if (shipsRef.current.size === 0 || ![...shipsRef.current.values()].some((s) => s.live)) {
          shipsRef.current = new Map()
        }
      }

      let gotData = false
      const markLive = () => {
        if (gotData) return
        gotData = true
        retryRef.current = 0
        setMode('live')
        setError(null)
      }

      ws.binaryType = 'arraybuffer' // aisstream 发二进制消息
      // 上游可能“连上了但没有数据”(Key 失效/上游断流):30s 无消息就主动重连,
      // 否则客户端会一直挂着空地图,永远走不到演示数据兜底。每条消息后重新计时
      const armWatchdog = () => {
        clearTimeout(ctrl.msgTimer)
        ctrl.msgTimer = setTimeout(() => {
          if (ctrl.stopped) return
          setError('AIS 实时流暂无数据,正在重连…')
          try { ws.close() } catch {}
        }, 30000)
      }
      ws.onmessage = async (e) => {
        armWatchdog()
        markLive()
        try {
          // aisstream 消息是二进制(Blob/ArrayBuffer),需转文本;复用同一个 decoder
          let text
          if (typeof e.data === 'string') {
            text = e.data
          } else if (e.data instanceof ArrayBuffer) {
            text = DECODER.decode(e.data)
          } else if (e.data instanceof Blob) {
            text = await e.data.text()
          } else {
            text = String(e.data)
          }
          const msg = JSON.parse(text)
          const type = msg.MessageType
          if (POS_TYPES.has(type)) {
            const pr = msg.Message?.[type]
            if (!pr) return
            const meta = msg.MetaData || {}
            const mmsi = String(pr.UserID)
            // AIS 的“不可用”哨兵值(纬度 91 / 经度 181)以及 (0,0) 不能上图
            if (!Number.isFinite(pr.Latitude) || !Number.isFinite(pr.Longitude)) return
            if (Math.abs(pr.Latitude) > 90 || Math.abs(pr.Longitude) > 180) return
            if (pr.Latitude === 0 && pr.Longitude === 0) return
            if (!shipsRef.current.has(mmsi) && shipsRef.current.size >= MAX_SHIPS) return
            const existing = shipsRef.current.get(mmsi)
            const pending = pendingStaticRef.current.get(mmsi)
            const ship = existing || {
              id: mmsi, mmsi: pr.UserID,
              name: nameClean(meta.ShipName) || pending?.name || `Vessel ${mmsi}`,
              type: pending?.type || aisShipType(meta.ShipType),
              country: mmsiCountry(pr.UserID),
              live: true,
            }
            // 静态消息可能先于位置到达:位置到达时补上船名/船型/目的港
            if (pending) {
              applyStatic(ship, pending)
              pendingStaticRef.current.delete(mmsi)
            }
            ship.coord = [pr.Longitude, pr.Latitude]
            ship.lat = pr.Latitude
            ship.lon = pr.Longitude
            // 哨兵值:COG=3600、HDG=511 表示不可用,SOG=1023 表示不可用
            const cog = Number(pr.Cog)
            const hdg = Number(pr.TrueHeading)
            const sog = Number(pr.Sog)
            ship.bearing = (Number.isFinite(cog) && cog < 360) ? cog
              : (Number.isFinite(hdg) && hdg < 360) ? hdg
                : ship.bearing ?? null
            ship.speedKnots = (Number.isFinite(sog) && sog < 1023) ? sog : ship.speedKnots ?? null
            ship.live = true
            ship.lastSeen = Date.now()
            if (!existing) shipsRef.current.set(mmsi, ship)
          } else if (type === 'ShipStaticData') {
            const sd = msg.Message?.ShipStaticData
            if (!sd) return
            const mmsi = String(sd.UserID)
            const st = {
              name: nameClean(sd.Name) || undefined,
              type: sd.Type ? aisShipType(sd.Type) : undefined,
              dest: nameClean(sd.Destination) || undefined,
              imo: sd.ImoNumber || undefined,
              callsign: nameClean(sd.CallSign) || undefined,
              length: sd.Dimension ? (sd.Dimension.A || 0) + (sd.Dimension.B || 0) || undefined : undefined,
              country: mmsiCountry(sd.UserID),
            }
            const existing = shipsRef.current.get(mmsi)
            if (existing) applyStatic(existing, st)
            else rememberStatic(mmsi, st)
          } else if (type === 'StaticDataReport') {
            // Class B 静态信息分 A/B 两包:A 包船名,B 包呼号/船型/尺寸
            const sd = msg.Message?.StaticDataReport
            if (!sd) return
            const mmsi = String(sd.UserID)
            const st = {}
            if (sd.ReportA) st.name = nameClean(sd.ReportA.Name) || undefined
            if (sd.ReportB) {
              st.callsign = nameClean(sd.ReportB.CallSign) || undefined
              if (sd.ReportB.ShipType) st.type = aisShipType(sd.ReportB.ShipType)
              if (sd.ReportB.Dimension) {
                st.length = (sd.ReportB.Dimension.A || 0) + (sd.ReportB.Dimension.B || 0) || undefined
              }
            }
            const existing = shipsRef.current.get(mmsi)
            if (existing) applyStatic(existing, st)
            else rememberStatic(mmsi, st)
          }
        } catch { /* 单条消息解析失败忽略 */ }
      }

      ws.onerror = () => {}
      ws.onclose = () => {
        clearTimeout(ctrl.msgTimer)
        if (wsRef.current === ws) wsRef.current = null
        if (ctrl.stopped) return
        retryRef.current++
        const delay = Math.min(30000, 2000 * Math.pow(1.5, retryRef.current))
        setError(`实时流断开,${Math.round(delay / 1000)}s 后重连(第 ${retryRef.current} 次)`)
        if (retryRef.current > 6) {
          setError('AIS 代理连接失败,已切换演示数据(请检查 Worker 的 AIS_API_KEY)')
          initDemo()
          return
        }
        ctrl.retryTimer = setTimeout(connect, delay)
      }
    }

    connect()
    reconnectRef.current = () => {
      retryRef.current = 0
      ctrl.stopped = false
      connect()
    }
    return () => {
      ctrl.stopped = true
      reconnectRef.current = null
      clearTimeout(ctrl.retryTimer)
      clearTimeout(ctrl.msgTimer)
      try { ctrl.ws?.close() } catch {}
    }
  }, [enabled, initDemo, rememberStatic, sendViewport])

  // 视野变化:通知 DO 更新过滤范围,并清掉离屏且 2 分钟没更新的船,避免长时间拖动后内存被离屏船占满
  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(() => {
      sendViewport(wsRef.current)
      if (!bbox) return
      const [w, s, e, n] = bbox
      const now = Date.now()
      for (const [mmsi, sh] of shipsRef.current) {
        const lo = sh.coord?.[0], la = sh.coord?.[1]
        if (!Number.isFinite(lo) || !Number.isFinite(la)) continue
        const inside = la >= s && la <= n && (w <= e ? lo >= w && lo <= e : lo >= w || lo <= e)
        if (!inside && now - (sh.lastSeen || 0) > 120000) shipsRef.current.delete(mmsi)
      }
    }, 600)
    return () => clearTimeout(t)
  }, [enabled, bbox?.[0], bbox?.[1], bbox?.[2], bbox?.[3], sendViewport])

  // 低频同步到 React(live: 1.5s;demo: 200ms 推进)
  useEffect(() => {
    if (!enabled) return
    if (mode === 'live') {
      const t = setInterval(() => {
        frameRef.current++
        const now = Date.now()
        let latest = 0
        for (const [mmsi, s] of shipsRef.current) {
          if (now - (s.lastSeen || 0) > STALE_MS) shipsRef.current.delete(mmsi)
          else if (s.lastSeen > latest) latest = s.lastSeen
        }
        if (latest) setUpdatedAt(latest)
        setShips([...shipsRef.current.values()])
      }, 1500)
      return () => clearInterval(t)
    }
    if (mode === 'demo') {
      let last = Date.now()
      const iv = setInterval(() => {
        const now = Date.now()
        const dt = now - last
        last = now
        const sim = simRef.current
        sim.time += dt * sim.speed
        advanceShips([...shipsRef.current.values()], dt, sim.speed)
        frameRef.current++
        setShips([...shipsRef.current.values()].map((s) => ({ ...s })))
      }, 200)
      return () => clearInterval(iv)
    }
  }, [enabled, mode])

  const setSimSpeed = (s) => { simRef.current.speed = s }
  const resetSim = () => { simRef.current.time = Date.now() }
  // 刷新 = 断开重连(上游 Key 失效/长时间无数据时手动恢复)
  // 演示兜底后 socket 已关闭,必须能重新发起连接,否则按钮点了没反应
  const refresh = () => {
    retryRef.current = 0
    const ws = wsRef.current
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close() } catch {}
      return
    }
    reconnectRef.current?.()
  }

  return {
    ships, mode, error, updatedAt,
    shipsRef, frameRef, simRef,
    setSimSpeed, resetSim, refresh,
    source: mode === 'live' ? 'aisstream.io 实时（经 Worker）' : '演示数据(真实航道模拟)',
  }
}
