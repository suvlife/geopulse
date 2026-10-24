import { describe, it, expect, vi, afterEach } from 'vitest'
import { displayNo, parseTime, parseCat, parseRadii, fetchList } from '../src/hooks/useTyphoons.js'

describe('displayNo', () => {
  it('takes the last two digits of a 6-digit storm id', () => {
    expect(displayNo('202631')).toBe('31')
    expect(displayNo(202601)).toBe('01')
    expect(displayNo('2026')).toBe('2026')
    expect(displayNo('')).toBe('')
    expect(displayNo(undefined)).toBe('')
  })
})

describe('parseTime', () => {
  it('treats naive timestamps as Beijing time (+08:00)', () => {
    expect(parseTime('2026-10-24 12:00:00')).toBe(Date.UTC(2026, 9, 24, 4, 0, 0))
    expect(parseTime('2026-10-24T12:00:00')).toBe(Date.UTC(2026, 9, 24, 4, 0, 0))
  })

  it('honors explicit Z / offsets', () => {
    expect(parseTime('2026-10-24T12:00:00Z')).toBe(Date.UTC(2026, 9, 24, 12, 0, 0))
    expect(parseTime('2026-10-24T12:00:00+02:00')).toBe(Date.UTC(2026, 9, 24, 10, 0, 0))
    expect(parseTime('2026-10-24T12:00:00+0200')).toBe(Date.UTC(2026, 9, 24, 10, 0, 0))
  })

  it('accepts second-level unix timestamps', () => {
    expect(parseTime(1761288000)).toBe(1761288000000)
  })

  it('returns NaN for empty input', () => {
    expect(Number.isNaN(parseTime(''))).toBe(true)
  })
})

describe('parseCat', () => {
  it('reads the English code from the parenthesized label', () => {
    expect(parseCat('台风(TY)', 35)).toBe('TY')
    expect(parseCat('强热带风暴(STS)', 28)).toBe('STS')
    expect(parseCat('超强台风(SuperTY)', 60)).toBe('SuperTY')
  })

  it('falls back to Chinese labels', () => {
    expect(parseCat('超强台风', 60)).toBe('SuperTY')
    expect(parseCat('强台风', 45)).toBe('STY')
    expect(parseCat('热带低压', 12)).toBe('TD')
  })

  it('falls back to wind speed when no label is present', () => {
    expect(parseCat('', 60)).toBe('SuperTY')
    expect(parseCat(null, 20)).toBe('TS')
    expect(parseCat(undefined, 0)).toBe('TD')
  })
})

describe('parseRadii', () => {
  it('uses quadrant values when present', () => {
    const r = parseRadii({ ne: 200, se: 150, sw: 120, nw: 180 }, 0)
    expect(r).toEqual({ ne: 200, se: 150, sw: 120, nw: 180 })
  })

  it('falls back to a uniform radius', () => {
    expect(parseRadii(null, 120)).toEqual({ ne: 120, se: 120, sw: 120, nw: 120 })
  })

  it('returns null when no usable radius', () => {
    expect(parseRadii(null, 0)).toBeNull()
    expect(parseRadii(undefined, undefined)).toBeNull()
  })
})

describe('fetchList', () => {
  afterEach(() => vi.unstubAllGlobals())

  const yearOf = (url) => url.includes('year=')
    ? url.split('year=')[1]
    : (url.match(/(\d{4})\.json/) || [])[1]

  it('falls back to last year when the current year file is valid but empty', async () => {
    const current = String(new Date().getFullYear())
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const empty = yearOf(url) === current
      return { ok: true, json: async () => (empty ? [] : [{ tfbh: `${Number(current) - 1}31`, name: '旧台风' }]) }
    }))
    const list = await fetchList()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('旧台风')
  })

  it('throws when both years are empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
    await expect(fetchList()).rejects.toThrow('empty-list')
  })
})
