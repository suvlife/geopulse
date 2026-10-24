import { describe, it, expect } from 'vitest'
import { normalize, emergencyOf } from '../src/hooks/useFlights.js'

const base = {
  hex: 'abc123',
  flight: 'CA123 ',
  r: 'B-1234',
  t: 'A320',
  lat: 40,
  lon: 116,
  alt_baro: 30000,
  gs: 450,
  track: 90,
  baro_rate: 1000,
  squawk: '1200',
  seen_pos: 30,
}

describe('emergencyOf', () => {
  it('maps emergency squawk codes', () => {
    expect(emergencyOf({ squawk: '7500' })).toBe('unlawful')
    expect(emergencyOf({ squawk: '7600' })).toBe('radio')
    expect(emergencyOf({ squawk: '7700' })).toBe('general')
  })

  it('ignores non-emergency state hints', () => {
    expect(emergencyOf({ squawk: '1200', emergency: 'none' })).toBeNull()
    expect(emergencyOf({ emergency: 'lifeguard' })).toBeNull()
    expect(emergencyOf({ emergency: 'minfuel' })).toBeNull()
    expect(emergencyOf({ emergency: 'nordo' })).toBe('nordo')
  })
})

describe('normalize', () => {
  const fetchedAt = 1_700_000_000_000

  it('converts units and computes real position age', () => {
    const [f] = normalize({ ac: [base] }, fetchedAt)
    expect(f.callsign).toBe('CA123')
    expect(f.reg).toBe('B-1234')
    expect(f.altM).toBe(9144)
    expect(f.speedKmh).toBe(833)
    expect(f.vrateMs).toBe(5.1)
    expect(f.posAgeS).toBe(30)
    expect(f.time).toBe(fetchedAt - 30_000)
    expect(f.emergency).toBeNull()
  })

  it('drops stale positions older than 3 minutes', () => {
    const out = normalize({ ac: [{ ...base, seen_pos: 200 }] }, fetchedAt)
    expect(out).toHaveLength(0)
  })

  it('keeps the aircraft when seen_pos is missing', () => {
    const { seen_pos, ...noAge } = base
    const out = normalize({ ac: [noAge] }, fetchedAt)
    expect(out).toHaveLength(1)
    expect(out[0].posAgeS).toBe(0)
  })

  it('rejects out-of-range coordinates', () => {
    expect(normalize({ ac: [{ ...base, lat: 91 }] }, fetchedAt)).toHaveLength(0)
    expect(normalize({ ac: [{ ...base, lon: 181 }] }, fetchedAt)).toHaveLength(0)
    expect(normalize({ ac: [{ ...base, lat: null }] }, fetchedAt)).toHaveLength(0)
  })

  it('marks ground aircraft and clears altitude', () => {
    const [f] = normalize({ ac: [{ ...base, alt_baro: 'ground' }] }, fetchedAt)
    expect(f.onGround).toBe(true)
    expect(f.altM).toBeNull()
  })

  it('tolerates an empty payload', () => {
    expect(normalize({}, fetchedAt)).toEqual([])
    expect(normalize({ ac: null }, fetchedAt)).toEqual([])
  })
})
