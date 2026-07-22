import { useState } from 'react'
import { GROUP_COLORS } from '../layers/satelliteLayers.js'

const GROUP_LABELS = {
  stations: '空间站',
  starlink: 'Starlink',
  gps: 'GPS',
  active: '活跃卫星',
}
const GROUP_COUNT = { stations: '~3', starlink: '~6500', gps: '~32', active: '~8500' }

export default function SatellitePanel({
  satellites, selected, onSelect, groups, setGroups,
  showOrbits, setShowOrbits, showFootprints, setShowFootprints,
  showLabels, setShowLabels, loading, error, updatedAt,
}) {
  const [query, setQuery] = useState('')

  const counts = {}
  const total = satellites.length
  for (const s of satellites) {
    counts[s.group] = (counts[s.group] || 0) + 1
  }

  const filtered = query.trim()
    ? satellites.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()) || s.norad === query.trim())
    : satellites

  return (
    <div className="panel">
      <div className="panel-title">
        🛰 卫星追踪
        <span className="badge live">CelesTrak</span>
      </div>
      {error && <div className="error-tip">TLE 加载失败:{error},自动重试中</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{loading && !total ? '…' : total}</div>
          <div className="stat-label">当前跟踪卫星</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{counts.starlink || 0}</div>
          <div className="stat-label">Starlink</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{counts.station || 0}</div>
          <div className="stat-label">空间站</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{counts.gps || 0}</div>
          <div className="stat-label">GPS</div>
        </div>
      </div>

      <div className="section-title">卫星分组</div>
      <div className="control-row wrap">
        {Object.entries(GROUP_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={groups[key] ? 'toggle-btn active' : 'toggle-btn'}
            onClick={() => setGroups((g) => ({ ...g, [key]: !g[key] }))}
          >
            {groups[key] ? '✅' : '⬜'} {label} <span className="section-sub">{GROUP_COUNT[key]}</span>
          </button>
        ))}
      </div>

      <div className="section-title">视觉效果</div>
      <div className="control-row wrap">
        <button className={showOrbits ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setShowOrbits(!showOrbits)}>
          🟢 轨道线
        </button>
        <button className={showFootprints ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setShowFootprints(!showFootprints)}>
          🔵 覆盖圈
        </button>
        <button className={showLabels ? 'toggle-btn active' : 'toggle-btn'} onClick={() => setShowLabels(!showLabels)}>
          🏷 标签
        </button>
      </div>

      <input
        className="search-input"
        placeholder="🔍 搜索卫星名称 / NORAD ID…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {selected && (
        <div className="detail-card">
          <div className="detail-head">
            <span className="mag-badge" style={{ background: `rgb(${GROUP_COLORS[selected.group]?.join(',')})`, minWidth: 'auto', padding: '4px 10px' }}>
              {selected.name}
            </span>
          </div>
          <div className="flight-detail-grid">
            <div><i>经度</i>{selected.lon.toFixed(2)}°</div>
            <div><i>纬度</i>{selected.lat.toFixed(2)}°</div>
            <div><i>高度</i>{(selected.alt / 1000).toFixed(0)} km</div>
            <div><i>NORAD ID</i>{selected.norad}</div>
            <div><i>类型</i>{selected.group === 'starlink' ? 'Starlink' : selected.group === 'station' ? '空间站' : selected.group === 'gps' ? 'GPS' : '其他'}</div>
            <div><i>速度</i>~{(Math.sqrt(398600 / (6371 + selected.alt / 1000)) * 3600).toFixed(0)} km/h</div>
          </div>
          <div className="detail-meta">轨道速度基于圆形轨道近似 · 实时光学推算</div>
        </div>
      )}

      <div className="list-title">
        卫星列表(点击定位)
        <span className="section-sub">{total} 颗 · 地球视图可拖拽/缩放</span>
      </div>
      <div className="quake-list">
        {filtered.slice(0, 200).map((s) => (
          <div
            key={s.id}
            className={selected?.id === s.id ? 'quake-row active' : 'quake-row'}
            onClick={() => onSelect(s)}
          >
            <span className="flight-dot" style={{ background: `rgb(${GROUP_COLORS[s.group]?.join(',')})` }} />
            <div className="quake-info">
              <div className="quake-place">{s.name}</div>
              <div className="quake-meta">
                NORAD {s.norad} · {(s.alt / 1000).toFixed(0)} km
                · {s.group === 'starlink' ? 'Starlink' : s.group === 'station' ? '空间站' : s.group === 'gps' ? 'GPS' : '其他'}
              </div>
            </div>
          </div>
        ))}
        {!loading && !filtered.length && <div className="empty">{query ? '没有匹配的卫星' : '暂无卫星数据'}</div>}
      </div>

      <div className="foot-note">
        数据:CelesTrak TLE (2h 刷新) · SGP4 轨道推算(本地物理计算,60ms 级精度) · 卫星位置逐帧连续运动,不消耗 API 配额 · 3D 地球可拖拽/缩放/旋转
      </div>
    </div>
  )
}