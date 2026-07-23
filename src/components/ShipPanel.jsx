import { useMemo, useState } from 'react'
import { SHIP_TYPE_COLORS, SHIP_TYPE_LABELS } from '../data/shipData.js'

function topCountries(ships, n = 8) {
  const c = {}
  for (const s of ships) c[s.country] = (c[s.country] || 0) + 1
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n)
}

export default function ShipPanel({
  ships, selected, onSelect, mode, error, source,
  colorBy, setColorBy, visibleTypes, setVisibleTypes,
  visibleCountries, setVisibleCountries,
  simSpeed, setSimSpeed, resetSim, simTimeRef,
}) {
  const [query, setQuery] = useState('')

  const stats = useMemo(() => {
    const byType = {}
    for (const s of ships) byType[s.type] = (byType[s.type] || 0) + 1
    return { byType, total: ships.length, countries: topCountries(ships) }
  }, [ships])

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    let list = ships
    if (q) list = list.filter((s) => s.name.toUpperCase().includes(q) || String(s.mmsi).includes(q))
    if (visibleCountries.size) list = list.filter((s) => visibleCountries.has(s.country))
    return list.filter((s) => visibleTypes[s.type] !== false)
  }, [ships, query, visibleTypes, visibleCountries])

  return (
    <div className="panel">
      <div className="panel-title">
        🚢 船舶追踪
        <span className={mode === 'live' ? 'badge live' : mode === 'connecting' ? 'badge demo' : 'badge demo'}>
          {mode === 'live' ? 'aisstream 实时' : mode === 'connecting' ? '连接中…' : '演示数据'}
        </span>
      </div>
      {error && <div className="error-tip">{error}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">在视野船舶</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{stats.countries.length}</div>
          <div className="stat-label">国籍</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{stats.byType.container || 0}</div>
          <div className="stat-label">集装箱船</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{stats.byType.tanker || 0}</div>
          <div className="stat-label">油轮</div>
        </div>
      </div>

      {mode === 'demo' && (
        <div className="error-tip" style={{ background: 'rgba(77,163,255,0.08)', borderColor: 'rgba(77,163,255,0.3)', color: '#9ec7ff' }}>
          ℹ️ aisstream 实时流连接失败,当前为<b>基于真实航道的演示数据</b>。将自动重连。
        </div>
      )}

      <div className="section-title">着色方式</div>
      <div className="control-row">
        <div className="seg">
          {[['type', '按船型'], ['country', '按国籍'], ['speed', '按航速']].map(([k, l]) => (
            <button key={k} className={colorBy === k ? 'seg-btn active' : 'seg-btn'} onClick={() => setColorBy(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="section-title">船型过滤</div>
      <div className="control-row wrap">
        {Object.entries(SHIP_TYPE_LABELS).map(([k, l]) => (
          <button
            key={k}
            className={visibleTypes[k] !== false ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setVisibleTypes((v) => ({ ...v, [k]: v[k] === false }))}
          >
            <span className="flight-dot" style={{ background: `rgb(${SHIP_TYPE_COLORS[k].join(',')})`, display: 'inline-block', marginRight: 4 }} />
            {l} <span className="section-sub">{stats.byType[k] || 0}</span>
          </button>
        ))}
      </div>

      <div className="section-title">国籍过滤(点击筛选,再点取消)</div>
      <div className="control-row wrap">
        {stats.countries.map(([country, count]) => (
          <button
            key={country}
            className={visibleCountries.has(country) ? 'agency-chip active' : 'agency-chip'}
            onClick={() => setVisibleCountries((s) => {
              const n = new Set(s)
              if (n.has(country)) n.delete(country); else n.add(country)
              return n
            })}
          >
            {country} <span className="group-count">{count}</span>
          </button>
        ))}
      </div>

      {mode === 'demo' && (
        <>
          <div className="section-title">⏱ 模拟速度 <span className="section-sub">{simTimeRef.current ? new Date(simTimeRef.current.time).toISOString().slice(0, 19).replace('T', ' ') + 'Z' : ''}</span></div>
          <div className="control-row">
            <div className="seg">
              {[1, 10, 60, 300].map((s) => (
                <button key={s} className={simSpeed === s ? 'seg-btn active' : 'seg-btn'} onClick={() => setSimSpeed(s)}>{s}×</button>
              ))}
            </div>
            <button className="speed-btn" onClick={resetSim}>⏮ 现在</button>
          </div>
        </>
      )}

      <input
        className="search-input"
        placeholder="🔍 搜索船名 / MMSI…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {selected && (
        <div className="detail-card">
          <div className="detail-head">
            <span className="mag-badge" style={{ background: `rgb(${(SHIP_TYPE_COLORS[selected.type] || SHIP_TYPE_COLORS.other).join(',')})`, minWidth: 'auto', padding: '4px 10px' }}>
              {selected.name}
            </span>
            <span className="detail-place">{SHIP_TYPE_LABELS[selected.type] || '未知'}</span>
          </div>
          <div className="flight-detail-grid">
            <div><i>MMSI</i>{selected.mmsi}</div>
            <div><i>IMO</i>{selected.imo}</div>
            <div><i>国籍</i>{selected.country}</div>
            <div><i>航速</i>{selected.speedKnots?.toFixed(1)} 节</div>
            <div><i>航向</i>{Math.round(selected.bearing || 0)}°</div>
            <div><i>目的港</i>{selected.dest}</div>
            <div><i>载重吨</i>{selected.dwt ? Math.round(selected.dwt).toLocaleString() : '—'}</div>
            <div><i>船长</i>{selected.length ? Math.round(selected.length) : '—'} m</div>
            <div><i>位置</i>{selected.coord?.[1].toFixed(2)}°, {selected.coord?.[0].toFixed(2)}°</div>
          </div>
        </div>
      )}

      <div className="list-title">
        船舶列表
        <span className="section-sub">{filtered.length} / {stats.total}</span>
      </div>
      <div className="quake-list">
        {filtered.slice(0, 200).map((s) => (
          <div
            key={s.id}
            className={selected?.id === s.id ? 'quake-row active' : 'quake-row'}
            onClick={() => onSelect(s)}
          >
            <span className="flight-dot" style={{ background: `rgb(${(SHIP_TYPE_COLORS[s.type] || SHIP_TYPE_COLORS.other).join(',')})` }} />
            <div className="quake-info">
              <div className="quake-place"><b>{s.name}</b></div>
              <div className="quake-meta">
                {SHIP_TYPE_LABELS[s.type]} · {s.country} · {s.speedKnots?.toFixed(0)}节 · → {s.dest}
              </div>
            </div>
          </div>
        ))}
        {!filtered.length && <div className="empty">{query ? '没有匹配的船舶' : '暂无船舶数据'}</div>}
      </div>

      <div className="foot-note">
        数据源:{source} · 船舶按真实航道(马六甲海峡 TSS 分道通航制)模拟移动,可切换真实 aisstream.io 流 · 国籍按 MMSI MID 识别 · 点击船查看完整档案
      </div>
    </div>
  )
}
