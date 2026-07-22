import { useEffect, useMemo, useState } from 'react'
import { GROUP_COLORS, GROUP_LABELS } from '../layers/satelliteLayers.js'
import { getSatPhoto, ORBIT_FALLBACK } from '../data/satPhotos.js'

const SPEED_OPTIONS = [0, 1, 10, 60, 300, 1000]

function fmtSimTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
}

export default function SatellitePanel({
  satellites, satinfo, selected, onSelect,
  visibleGroups, setVisibleGroups,
  speed, setTimeSpeed, resetTime, simTimeRef,
  showFootprint, setShowFootprint,
  loading, progress, error, updatedAt,
}) {
  const [query, setQuery] = useState('')
  const [clock, setClock] = useState('')

  // 时钟显示
  useEffect(() => {
    const t = setInterval(() => {
      if (simTimeRef.current) setClock(fmtSimTime(simTimeRef.current.time))
    }, 250)
    return () => clearInterval(t)
  }, [simTimeRef])

  const counts = useMemo(() => {
    const c = {}
    for (const s of satellites) c[s.group] = (c[s.group] || 0) + 1
    return c
  }, [satellites])

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    let list = satellites
    if (q) list = list.filter((s) => s.name.toUpperCase().includes(q) || s.norad === q)
    return list
  }, [satellites, query])

  const photo = selected ? getSatPhoto(selected) : null
  const cat = selected ? satinfo?.get(selected.norad) : null
  const orbitType = selected
    ? ORBIT_FALLBACK.find((o) => selected.alt <= o.maxAlt) || ORBIT_FALLBACK[0]
    : null
  const total = satellites.length

  return (
    <div className="panel">
      <div className="panel-title">
        🛰 卫星追踪
        <span className={error ? 'badge demo' : 'badge live'}>{error ? '加载失败' : 'CelesTrak 实时'}</span>
      </div>
      {error && <div className="error-tip">TLE 加载失败:{error} · 将自动重试</div>}

      {loading && progress > 0 && progress < 1 && (
        <div className="load-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{loading && !total ? '…' : total.toLocaleString()}</div>
          <div className="stat-label">在轨目标</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{counts.starlink || 0}</div>
          <div className="stat-label">星链</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{counts.stations || 0}</div>
          <div className="stat-label">空间站</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{(counts.gps || 0) + (counts.beidou || 0) + (counts.glonass || 0) + (counts.galileo || 0)}</div>
          <div className="stat-label">导航卫星</div>
        </div>
      </div>

      <div className="section-title">
        ⏱ 时间控制
        <span className="section-sub clock">{clock}</span>
      </div>
      <div className="control-row">
        <div className="seg">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              className={speed === s ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setTimeSpeed(s)}
              title={s === 0 ? '暂停' : `${s}倍速`}
            >
              {s === 0 ? '⏸' : `${s}×`}
            </button>
          ))}
        </div>
        <button className="speed-btn" onClick={resetTime} title="回到当前时间">⏮ 现在</button>
      </div>

      <div className="section-title">星座分组</div>
      <div className="group-grid">
        {Object.entries(GROUP_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={visibleGroups[key] !== false ? 'group-chip active' : 'group-chip'}
            style={{ '--c': `rgb(${GROUP_COLORS[key].join(',')})` }}
            onClick={() => setVisibleGroups((g) => ({ ...g, [key]: g[key] === false }))}
          >
            <i className="group-dot" />{label}
            <span className="group-count">{counts[key] || 0}</span>
          </button>
        ))}
      </div>

      <div className="control-row wrap" style={{ marginTop: 10 }}>
        <button
          className={showFootprint ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => setShowFootprint(!showFootprint)}
        >🔵 选中显示覆盖圈</button>
      </div>

      <input
        className="search-input"
        placeholder="🔍 搜索卫星名称 / NORAD ID(如 ISS、STARLINK-1008)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {selected && (
        <div className="detail-card">
          <div className="detail-head">
            <span
              className="mag-badge"
              style={{
                background: `rgb(${(GROUP_COLORS[selected.group] || GROUP_COLORS.others).join(',')})`,
                minWidth: 'auto', padding: '4px 10px',
              }}
            >
              {selected.name}
            </span>
            <span className="detail-place">{GROUP_LABELS[selected.group]}</span>
          </div>

          {photo && (
            <div className="plane-photo">
              <img src={photo.src} alt={selected.name} loading="lazy" />
              <span className="photo-credit">📷 {photo.credit}</span>
            </div>
          )}

          <div className="flight-detail-grid">
            <div><i>经度</i>{selected.lon.toFixed(2)}°</div>
            <div><i>纬度</i>{selected.lat.toFixed(2)}°</div>
            <div><i>高度</i>{(selected.alt / 1000).toFixed(0)} km</div>
            <div><i>NORAD ID</i>{selected.norad}</div>
            <div><i>轨道速度</i>~{(Math.sqrt(398600 / (6371 + selected.alt / 1000)) * 3600).toFixed(0)} km/h</div>
            <div><i>轨道类型</i><span style={{ color: orbitType?.color }}>{orbitType?.label}</span></div>
          </div>

          {cat && (
            <div className="satcat-box">
              <div className="section-title" style={{ margin: '10px 0 6px' }}>📋 档案(SATCAT)</div>
              <div className="flight-detail-grid">
                {cat.owner && <div><i>所属</i>{cat.owner}</div>}
                {cat.launch && <div><i>发射日期</i>{cat.launch}</div>}
                {cat.period && <div><i>轨道周期</i>{cat.period.toFixed(1)} min</div>}
                {cat.inclination && <div><i>倾角</i>{cat.inclination.toFixed(1)}°</div>}
                {cat.apogee && <div><i>远地点</i>{cat.apogee.toFixed(0)} km</div>}
                {cat.perigee && <div><i>近地点</i>{cat.perigee.toFixed(0)} km</div>}
              </div>
            </div>
          )}

          <a
            className="detail-link"
            href={`https://www.n2yo.com/satellite/?s=${selected.norad}`}
            target="_blank"
            rel="noreferrer"
          >N2YO 详情页 ↗</a>
        </div>
      )}

      <div className="list-title">
        卫星列表
        <span className="section-sub">{query ? `${filtered.length} 匹配` : `${total.toLocaleString()} 颗`}</span>
      </div>
      <div className="quake-list">
        {filtered.slice(0, 300).map((s) => (
          <div
            key={s.id}
            className={selected?.id === s.id ? 'quake-row active' : 'quake-row'}
            onClick={() => onSelect(s)}
          >
            <span className="flight-dot" style={{ background: `rgb(${(GROUP_COLORS[s.group] || GROUP_COLORS.others).join(',')})` }} />
            <div className="quake-info">
              <div className="quake-place">{s.name}</div>
              <div className="quake-meta">
                NORAD {s.norad} · {(s.alt / 1000).toFixed(0)} km · {GROUP_LABELS[s.group]}
              </div>
            </div>
          </div>
        ))}
        {!loading && !filtered.length && <div className="empty">{query ? '没有匹配的卫星' : '正在加载 TLE 数据…'}</div>}
      </div>

      <div className="foot-note">
        数据:CelesTrak NORAD GP(TLE,2h 刷新)+ SATCAT 档案 · SGP4 本地推算,卫星逐帧连续运动 · 时间可加速至 1000× · 3D 地球可拖拽/缩放/旋转,点任意卫星查看照片与档案
      </div>
    </div>
  )
}
