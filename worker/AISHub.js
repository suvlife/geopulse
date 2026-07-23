// Durable Object:全局单例共享一条 aisstream 上游连接,扇出给所有客户端
// aisstream 免费账号只允许 1 条并发 WebSocket,必须在服务端做单例复用

export class AISHub {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.upstream = null
    this.clients = new Set()
    this.connecting = false
  }

  async connectUpstream() {
    if (this.upstream && this.upstream.readyState === 1) return
    if (this.connecting) return
    this.connecting = true
    try {
      const ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
      this.upstream = ws
      ws.addEventListener('open', () => {
        this.connecting = false
        try {
          ws.send(JSON.stringify({
            APIKey: this.env.AIS_API_KEY,
            BoundingBoxes: [[[-90, -180], [90, 180]]],
          }))
        } catch {}
      })
      ws.addEventListener('message', (e) => {
        // 扇出给所有客户端
        for (const c of this.clients) {
          try { c.send(e.data) } catch { this.clients.delete(c) }
        }
      })
      const cleanup = () => {
        this.upstream = null
        this.connecting = false
        for (const c of this.clients) { try { c.close(1011, 'upstream lost') } catch {} }
        this.clients.clear()
      }
      ws.addEventListener('close', cleanup)
      ws.addEventListener('error', cleanup)
    } catch (e) {
      this.connecting = false
      this.upstream = null
    }
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expect websocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()
    this.clients.add(server)
    server.addEventListener('close', () => { this.clients.delete(server) })
    server.addEventListener('error', () => { this.clients.delete(server) })

    // 确保上游连接存在
    this.state.waitUntil(this.connectUpstream())

    return new Response(null, { status: 101, webSocket: client })
  }
}
