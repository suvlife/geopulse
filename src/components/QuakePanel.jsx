import { useMemo } from 'react'
import { magColor } from '../utils/scales.js'
import { fmtTime } from '../utils/geo.js'

function timeAgo(t, now) {
  const m = Math.floor((now - t) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

const RANGES = [
  { key: 'day', label: '24 小时' },
  { key: 'week', label: '7 天' },
  { key: 'month', label: '30 天' },
]

export default function QuakePanel({ quakes, params, setParams, selected, onSelect, loading, error, now }) {
  const stats = useMemo(() => {
    if (!quakes.length) return { max: null, m5: 0, latest: null }
    let max = quakes[0]
    let m5 = 0
    for (const q of quakes) {
      if (q.mag > max.mag) max = q
      if (q.mag >= 5) m5++
    }
    return { max, m5, latest: quakes[0] }
  }, [quakes])

  return (
    <div className="panel">
      <div className="panel-title">
        🌍 全球地震监测
        <span className="badge live">USGS 实时</span>
      </div>

      {error && <div className="error-tip">数据加载失败：{error}，将自动重试</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{loading ? '…' : quakes.length}</div>
          <div className="stat-label">地震总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: stats.max ? `rgb(${magColor(stats.max.mag).join(',')})` : undefined }}>
            {stats.max ? `M${stats.max.mag.toFixed(1)}` : '—'}
          </div>
          <div className="stat-label">最大震级</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.m5}</div>
          <div className="stat-label">M5+ 强震</div>
        </div>
        <div className="stat-card">
          <div className="stat-value small">{stats.latest ? timeAgo(stats.latest.time, now) : '—'}</div>
          <div className="stat-label">最近一次</div>
        </div>
      </div>

      <div className="control-row">
        <div className="seg">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={params.range === r.key ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setParams((p) => ({ ...p, range: r.key }))}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-row">
        <label className="slider-label">
          最小震级 <b>M{params.minMag.toFixed(1)}</b>
          <input
            type="range" min="0" max="6" step="0.5" value={params.minMag}
            onChange={(e) => setParams((p) => ({ ...p, minMag: +e.target.value }))}
          />
        </label>
      </div>

      <div className="control-row wrap">
        <div className="seg">
          <button
            className={params.colorBy === 'mag' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setParams((p) => ({ ...p, colorBy: 'mag' }))}
          >按震级着色</button>
          <button
            className={params.colorBy === 'depth' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setParams((p) => ({ ...p, colorBy: 'depth' }))}
          >按深度着色</button>
        </div>
        <button
          className={params.heatmap ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => setParams((p) => ({ ...p, heatmap: !p.heatmap }))}
        >🔥 热力图</button>
      </div>

      {selected && (
        <div className="detail-card">
          <div className="detail-head">
            <span className="mag-badge" style={{ background: `rgb(${magColor(selected.mag).join(',')})` }}>
              M{selected.mag.toFixed(1)}
            </span>
            <span className="detail-place">{selected.place}</span>
          </div>
          <div className="detail-meta">
            {fmtTime(selected.time)} · 深度 {selected.depth.toFixed(0)} km
            {selected.tsunami && <span className="tsunami"> ⚠️ 海啸预警</span>}
          </div>
          <a href={selected.url} target="_blank" rel="noreferrer" className="detail-link">USGS 详情 ↗</a>
        </div>
      )}

      <div className="list-title">最新地震（点击定位）</div>
      <div className="quake-list">
        {quakes.slice(0, 100).map((q) => (
          <div
            key={q.id}
            className={selected?.id === q.id ? 'quake-row active' : 'quake-row'}
            onClick={() => onSelect(q)}
          >
            <span className="mag-badge" style={{ background: `rgb(${magColor(q.mag).join(',')})` }}>
              {q.mag.toFixed(1)}
            </span>
            <div className="quake-info">
              <div className="quake-place">{q.place}</div>
              <div className="quake-meta">{timeAgo(q.time, now)} · 深 {q.depth.toFixed(0)} km</div>
            </div>
          </div>
        ))}
        {!loading && !quakes.length && <div className="empty">当前筛选条件下暂无地震记录</div>}
      </div>
    </div>
  )
}
