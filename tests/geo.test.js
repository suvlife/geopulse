import { describe, it, expect } from 'vitest'
import { haversine, destPoint, windQuadPolygon, cityImpact, fmtTime, fmtCountdown } from '../src/utils/geo.js'

describe('haversine', () => {
  it('measures Beijing → Shanghai (~1067 km)', () => {
    const d = haversine([116.4, 39.9], [121.47, 31.23])
    expect(d).toBeGreaterThan(1040)
    expect(d).toBeLessThan(1100)
  })
})

describe('destPoint', () => {
  it('moves 100 km due east and stays on the same latitude near the equator', () => {
    const p = destPoint([0, 0], 90, 100)
    expect(p[0]).toBeCloseTo(0.899, 2)
    expect(p[1]).toBeCloseTo(0, 5)
  })
})

describe('windQuadPolygon', () => {
  const center = [120, 20]
  const radii = { ne: 200, se: 100, sw: 100, nw: 200 }

  it('returns a closed ring with one point per sector step', () => {
    const ring = windQuadPolygon(center, radii, 16)
    expect(ring).toHaveLength(4 * 16 + 1)
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('uses constant radius inside each quadrant (no interpolation)', () => {
    const ring = windQuadPolygon(center, radii, 8)
    const ne = haversine(center, ring[0]) // bearing 0, NE radius
    const se = haversine(center, ring[8]) // bearing 90, SE radius
    const sw = haversine(center, ring[16]) // bearing 180
    expect(ne).toBeCloseTo(200, 0)
    expect(se).toBeCloseTo(100, 0)
    expect(sw).toBeCloseTo(100, 0)
  })
})

describe('cityImpact', () => {
  const city = { name: 'Test', coord: [5, 1] }
  const t0 = Date.UTC(2026, 9, 24, 0, 0)

  it('projects the city onto the segment and interpolates time', () => {
    const track = [
      { coord: [0, 0], time: t0 },
      { coord: [10, 0], time: t0 + 10 * 3600e3 },
    ]
    const hit = cityImpact(track, city, 300)
    expect(hit).not.toBeNull()
    expect(hit.dist).toBeCloseTo(111, 0)
    expect(hit.time).toBeCloseTo(t0 + 5 * 3600e3, -4)
  })

  it('returns null when the track never comes within the threshold', () => {
    const track = [
      { coord: [0, 40], time: t0 },
      { coord: [10, 40], time: t0 + 3600e3 },
    ]
    expect(cityImpact(track, city, 300)).toBeNull()
  })

  it('handles a single-point track', () => {
    expect(cityImpact([{ coord: [5, 1], time: t0 }], city, 300)?.dist).toBeCloseTo(0, 5)
    expect(cityImpact([{ coord: [5, 10], time: t0 }], city, 300)).toBeNull()
  })
})

describe('fmtTime', () => {
  it('formats in Asia/Shanghai regardless of local timezone', () => {
    expect(fmtTime(Date.UTC(2026, 0, 1, 0, 0))).toBe('1/1 08:00')
    expect(fmtTime(Date.UTC(2026, 9, 24, 16, 30))).toBe('10/25 00:30')
  })

  it('returns — for invalid input', () => {
    expect(fmtTime(NaN)).toBe('—')
  })
})

describe('fmtCountdown', () => {
  it('formats hours and days', () => {
    expect(fmtCountdown(0)).toBe('正在影响')
    expect(fmtCountdown(90 * 60e3)).toBe('1小时30分')
    expect(fmtCountdown(72 * 3600e3)).toBe('约 3 天后')
  })
})
