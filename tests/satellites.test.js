import { describe, it, expect } from 'vitest'
import { tleEpochMs, parseTLE, parseSatcat } from '../src/hooks/useSatellites.js'
import { inBox } from '../worker/AISHub.js'

const ISS = `ISS (ZARYA)
1 25544U 98067A   26297.12345678  .00016717  00000-0  10270-3 0  9008
2 25544  51.6400 208.9163 0004050  35.2630  43.1225 15.49815710 12345`

describe('tleEpochMs', () => {
  it('parses YYDDD.DDDD epoch as UTC', () => {
    const l1 = ISS.split('\n')[1]
    const ms = tleEpochMs(l1)
    // 2026-10-24T02:57:46.666Z
    expect(Math.round(ms / 1000)).toBe(Math.round(Date.UTC(2026, 9, 24, 2, 57, 46, 666) / 1000))
  })

  it('returns NaN for garbage', () => {
    expect(Number.isNaN(tleEpochMs('not a tle'))).toBe(true)
  })
})

describe('parseTLE', () => {
  it('parses 3-line records and reports the newest epoch', () => {
    const { recs, epochMax } = parseTLE(ISS + '\n')
    expect(recs).toHaveLength(1)
    expect(recs[0].name).toBe('ISS (ZARYA)')
    expect(recs[0].satrec).toBeTruthy()
    expect(epochMax).toBeGreaterThan(0)
  })

  it('skips malformed blocks instead of throwing', () => {
    const { recs } = parseTLE('BAD\n1 x\n2 y\n\n\n')
    expect(recs).toHaveLength(0)
  })
})

describe('parseSatcat', () => {
  it('indexes by NORAD id without leading zeros', () => {
    const csv = [
      'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE',
      'ISS (ZARYA),1998-067A,25544,PAYLOAD,+,US,1998-11-20,TTMTR,,92.88,51.64,420,410',
      'STARLINK-1007,2019-029F,00447,PAYLOAD,+,US,2019-05-24,AFETR,,95.59,53.00,550,540',
    ].join('\n')
    const m = parseSatcat(csv)
    expect(m.get('25544').owner).toBe('US')
    expect(m.get('25544').period).toBeCloseTo(92.88, 2)
    expect(m.has('447')).toBe(true)
    expect(m.has('00447')).toBe(false)
    expect(m.get('447').inclination).toBeCloseTo(53, 2)
  })
})

describe('AISHub inBox', () => {
  it('passes everything when no bbox is set', () => {
    expect(inBox(120, 20, null)).toBe(true)
  })

  it('filters by a normal bbox', () => {
    const box = [100, 0, 110, 10]
    expect(inBox(105, 5, box)).toBe(true)
    expect(inBox(120, 5, box)).toBe(false)
    expect(inBox(105, 20, box)).toBe(false)
  })

  it('handles a bbox crossing the antimeridian', () => {
    const box = [170, -10, -170, 10] // 170E → 170W
    expect(inBox(179, 0, box)).toBe(true)
    expect(inBox(-179, 0, box)).toBe(true)
    expect(inBox(0, 0, box)).toBe(false)
  })
})
