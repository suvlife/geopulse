// Durable Object:全局单例共享一条 aisstream 上游连接,扇出给所有客户端
// aisstream 免费账号只允许少量并发 WebSocket,必须在服务端做单例复用
// Key 只存在 Worker secret(AIS_API_KEY),浏览器端不接触 Key,也不直连 aisstream

const RECONNECT_MIN = 2000
const RECONNECT_MAX = 30000

// 判断点是否在 [west, south, east, north] 内;west > east 表示跨 180° 经线
export function inBox(lon, lat, box) {
  if (!box) return true
  const [w, s, e, n] = box
  if (lat < s || lat > n) return false
  return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e
}

export class AISHub {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.upstream = null
    this.clients = new Set()
    this.clientBox = new Map() // 客户端 → 视野 bbox(null = 不过滤)
    this.connecting = false
    this.retry = 0
    this.lastError = null
    this.lastMessageAt = 0
    this.subscribed = false
    this.msgEvents = 0
  }

  scheduleReconnect() {
    if (!this.clients.size) return
    const delay = Math.min(RECONNECT_MAX, RECONNECT_MIN * 2 ** Math.min(this.retry++, 4))
    // DO 用 alarm 做可靠延时(普通 setTimeout 在休眠/回收后会丢)
    this.state.storage.setAlarm(Date.now() + delay)
  }

  async alarm() {
    if (this.clients.size) await this.connectUpstream()
  }

  async connectUpstream() {
    if (!this.env.AIS_API_KEY) {
      for (const c of this.clients) { try { c.close(1011, 'server misconfigured') } catch {} }
      this.clients.clear()
      return
    }
    if (this.upstream && this.upstream.readyState === 1) return
    if (this.connecting) return
    this.connecting = true
    try {
      let ws
      let subscribed = false
      const subscribe = () => {
        if (subscribed) return
        try {
          const payload = JSON.stringify({
            APIKey: this.env.AIS_API_KEY,
            // 上游仍订阅全球:免费账号只有 1 条连接,多访客视野的并集基本就是全球;
            // 下行按每个客户端的视野在 DO 内过滤,减少浏览器带宽与渲染压力
            BoundingBoxes: [[[-90, -180], [90, 180]]],
          })
          ws.send(payload)
          subscribed = true
          this.subscribed = true
          this.connecting = false
          this.retry = 0
          console.log('ais subscribed, bytes:', payload.length)
        } catch (e) {
          // 发送失败必须断开重连,否则会一直挂在“已连接但没有订阅”的空转状态
          console.log('ais subscribe failed:', String(e))
          try { ws.close(1011, 'subscribe failed') } catch {}
        }
      }

      // 用标准 WebSocket 连接(本地同 key 验证可用)
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
      this.upstream = ws
      ws.addEventListener('open', subscribe)
      ws.addEventListener('message', async (e) => {
        this.msgEvents++
        if (this.msgEvents === 1) this.firstType = `${typeof e.data}:${e.data?.constructor?.name || ''}`
        // aisstream 发二进制消息,统一转文本再扇出:
        // Workers 可能给 ArrayBuffer / Uint8Array / Blob,三种都要处理
        let data
        try {
          const d = e.data
          if (typeof d === 'string') data = d
          else if (d instanceof ArrayBuffer) data = new TextDecoder().decode(d)
          else if (ArrayBuffer.isView(d)) data = new TextDecoder().decode(d)
          else if (typeof d?.text === 'function') data = await d.text()
          else data = String(d)
        } catch (err) { this.decodeError = String(err); return }
        if (data.includes('"error"')) {
          // 无效 Key / 超并发:断开并退避,避免空转
          this.retry = Math.max(this.retry, 2)
          this.lastError = data.slice(0, 300)
        }
        // 按客户端视野裁剪:位置报文只有落在该客户端 bbox 内才下发;
        // 静态报文(船名/目的港)没有坐标,体积小,照常广播
        this.lastMessageAt = Date.now()
        if (!this._loggedFirst) { this._loggedFirst = true; console.log('ais first message bytes:', data.length) }
        let pos = null
        try {
          const j = JSON.parse(data)
          const p = j.Message?.[j.MessageType]
          if (p && Number.isFinite(p.Latitude) && Number.isFinite(p.Longitude)) {
            pos = [p.Longitude, p.Latitude]
          }
        } catch { /* 非 JSON 或结构异常:不裁剪 */ }
        for (const c of this.clients) {
          if (pos && !inBox(pos[0], pos[1], this.clientBox.get(c))) continue
          try { c.send(data) } catch {
            this.clients.delete(c)
            this.clientBox.delete(c)
          }
        }
      })
      ws.addEventListener('close', (ev) => {
        console.log('ais upstream close', ev?.code, ev?.reason || '')
        if (this.upstream === ws) this.upstream = null
        this.connecting = false
        this.scheduleReconnect()
      })
      ws.addEventListener('error', (ev) => {
        console.log('ais upstream error', String(ev?.message || ev?.error || 'unknown'))
        if (this.upstream === ws) this.upstream = null
        this.connecting = false
        this.scheduleReconnect()
      })
    } catch {
      this.connecting = false
      this.upstream = null
      this.scheduleReconnect()
    }
  }

  async fetch(request) {
    const url = new URL(request.url)
    // 运维诊断:不暴露 Key,只给出上游状态,便于区分“Key 失效”和“边缘 IP 被拒”
    if (url.pathname === '/status') {
      return Response.json({
        clients: this.clients.size,
        connecting: this.connecting,
        retry: this.retry,
        upstream: this.upstream ? this.upstream.readyState : null,
        subscribed: this.subscribed,
        msgEvents: this.msgEvents,
        firstType: this.firstType || null,
        decodeError: this.decodeError || null, // 0 连接中 1 已连接 2 关闭中 3 已关闭
        lastError: this.lastError || null,
        lastMessageAt: this.lastMessageAt || null,
      })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expect websocket', { status: 426 })
    }
    if (this.clients.size >= 500) {
      return new Response('too many clients', { status: 503 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()
    this.clients.add(server)
    this.clientBox.set(server, null)

    const drop = () => {
      this.clients.delete(server)
      this.clientBox.delete(server)
      // 最后一个访客离开后关闭上游,避免 DO 空转计费;下次连接重新建立
      if (!this.clients.size && this.upstream) {
        try { this.upstream.close() } catch {}
        this.upstream = null
      }
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)

    // 客户端上报视野(地图 moveend 后发送);只用于扇出过滤,不影响上游订阅
    server.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data))
        if (msg?.type !== 'viewport') return
        const b = msg.bbox
        if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) {
          this.clientBox.set(server, null) // 无效/空视野 → 不过滤
          return
        }
        const [w, s, e, n] = b.map(Number)
        if (Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 360 || Math.abs(e) > 360 || s > n) {
          this.clientBox.set(server, null)
          return
        }
        this.clientBox.set(server, [w, s, e, n])
      } catch { /* 非本协议的客户端消息忽略 */ }
    })

    this.state.waitUntil(this.connectUpstream())

    return new Response(null, { status: 101, webSocket: client })
  }
}
