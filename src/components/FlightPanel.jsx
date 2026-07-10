import { useMemo, useState } from 'react'
import { altColor } from '../utils/scales.js'

function fmtAgo(t, now) {
  const s = Math.floor((now - t) / 1000)
  return s < 5 ? '刚刚' : `${s}s 前`
}

export default function FlightPanel({ flights, selected, onSelect, loading, error, updatedAt, source, now }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    const list = q
      ? flights.filter((f) => f.callsign.toUpperCase().includes(q) || f.reg.toUpperCase().includes(q) || f.type.toUpperCase().includes(q))
      : flights
    return [...list].sort((a, b) => (a.distKm ?? 1e9) - (b.distKm ?? 1e9))
  }, [flights, query])

  const stats = useMemo(() => {
    let highest = null, fastest = null, ground = 0
    for (const f of flights) {
      if (f.onGround) ground++
      if (f.altM != null && (!highest || f.altM > highest.altM)) highest = f
      if (f.speedKmh != null && (!fastest || f.speedKmh > fastest.speedKmh)) fastest = f
    }
    return { highest, fastest, ground }
  }, [flights])

  const sel = flights.find((f) => f.hex === selected)

  return (
    <div className="panel">
      <div className="panel-title">
        ✈️ 实时航班
        <span className="badge live">{source || 'ADS-B'}</span>
      </div>

      {error && <div className="error-tip">数据加载失败:{error},自动重试中</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{loading && !flights.length ? '…' : flights.length}</div>
          <div className="stat-label">视野内航班</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.ground}</div>
          <div className="stat-label">地面滑行</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{stats.highest ? `${(stats.highest.altM / 1000).toFixed(1)}km` : '—'}</div>
          <div className="stat-label">最高 {stats.highest?.callsign || ''}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{stats.fastest ? `${stats.fastest.speedKmh}` : '—'}<span className="unit"> km/h</span></div>
          <div className="stat-label">最快 {stats.fastest?.callsign || ''}</div>
        </div>
      </div>

      <input
        className="search-input"
        placeholder="🔍 搜索航班号 / 注册号 / 机型…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {sel && (
        <div className="detail-card">
          <div className="detail-head">
            <span className="mag-badge" style={{ background: `rgb(${altColor(sel.altM).join(',')})`, minWidth: 'auto', padding: '4px 10px' }}>
              {sel.callsign}
            </span>
            <span className="detail-place">{sel.type || '未知机型'}{sel.reg ? ` · ${sel.reg}` : ''}</span>
          </div>
          {sel.emergency && <div className="error-tip" style={{ marginTop: 8 }}>⚠️ 紧急状态:{sel.emergency}</div>}
          <div className="flight-detail-grid">
            <div><i>高度</i>{sel.onGround ? '地面' : sel.altM != null ? `${sel.altM} m` : '—'}</div>
            <div><i>地速</i>{sel.speedKmh != null ? `${sel.speedKmh} km/h` : '—'}</div>
            <div><i>航向</i>{sel.track != null ? `${Math.round(sel.track)}°` : '—'}</div>
            <div><i>垂直速率</i>{sel.vrateMs != null ? `${sel.vrateMs > 0 ? '↑' : sel.vrateMs < 0 ? '↓' : ''}${Math.abs(sel.vrateMs)} m/s` : '—'}</div>
            <div><i>应答机</i>{sel.squawk || '—'}</div>
            <div><i>ICAO24</i>{sel.hex.toUpperCase()}</div>
          </div>
          <div className="detail-meta">位置更新:{fmtAgo(sel.time, now)} · 轨迹随追踪时间增长</div>
        </div>
      )}

      <div className="list-title">
        附近航班(按距离排序,点击追踪)
        <span className="section-sub">{updatedAt ? `${fmtAgo(updatedAt, now)}更新` : ''}</span>
      </div>
      <div className="quake-list">
        {filtered.slice(0, 100).map((f) => (
          <div
            key={f.hex}
            className={selected === f.hex ? 'quake-row active' : 'quake-row'}
            onClick={() => onSelect(f)}
          >
            <span className="flight-dot" style={{ background: `rgb(${altColor(f.onGround ? null : f.altM).join(',')})` }} />
            <div className="quake-info">
              <div className="quake-place">
                <b>{f.callsign}</b>{f.type ? ` · ${f.type}` : ''}{f.reg ? ` · ${f.reg}` : ''}
              </div>
              <div className="quake-meta">
                {f.onGround ? '地面' : f.altM != null ? `${f.altM} m` : '高度未知'}
                {f.speedKmh != null ? ` · ${f.speedKmh} km/h` : ''}
                {f.distKm != null ? ` · 距中心 ${f.distKm} km` : ''}
              </div>
            </div>
          </div>
        ))}
        {!loading && !filtered.length && <div className="empty">{query ? '没有匹配的航班' : '当前区域暂无航班数据'}</div>}
      </div>

      <div className="foot-note">
        数据:adsb.lol / airplanes.live 社区 ADS-B 网络(免费)· 覆盖:视野中心 463km 半径(虚线圈),移动地图自动加载 · 12s 刷新 · 航路轨迹为轮询累积,选中后持续追踪可见完整航路
      </div>
    </div>
  )
}
