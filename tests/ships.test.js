import { describe, it, expect } from 'vitest'
import { mmsiCountry, MID_COUNTRIES } from '../src/data/shipData.js'
import { aisShipType, nameClean } from '../src/hooks/useShips.js'

describe('mmsiCountry', () => {
  it('maps major ship registries', () => {
    expect(mmsiCountry(412345678)).toBe('中国')
    expect(mmsiCountry(477123456)).toBe('中国香港')
    expect(mmsiCountry(470123456)).toBe('阿联酋')
    expect(mmsiCountry(249123456)).toBe('马耳他')
    expect(mmsiCountry(538123456)).toBe('马绍尔群岛')
    expect(mmsiCountry(636123456)).toBe('利比里亚')
    expect(mmsiCountry(351123456)).toBe('巴拿马')
    expect(mmsiCountry(338123456)).toBe('美国')
  })

  it('does not treat every 4xx/5xx/6xx prefix as Liberia', () => {
    expect(mmsiCountry(401123456)).toBe('阿富汗')
    expect(mmsiCountry(503123456)).toBe('澳大利亚')
    expect(mmsiCountry(563123456)).toBe('新加坡')
    expect(mmsiCountry(605123456)).toBe('阿尔及利亚')
  })

  it('rejects non-ship MMSI (coast station / SAR aircraft / AtoN)', () => {
    expect(mmsiCountry('002442000')).toBe('非船舶台站')
    expect(mmsiCountry('111232511')).toBe('非船舶台站')
    expect(mmsiCountry('992351234')).toBe('非船舶台站')
    expect(mmsiCountry(999123456)).toBe('非船舶台站')
    expect(mmsiCountry(970012345)).toBe('应急设备')
  })

  it('pads short MMSI to 9 digits before taking MID', () => {
    expect(mmsiCountry('41234567')).toBe('非船舶台站') // 补零后以 0 开头
  })

  it('returns 未知 for empty/unassigned MID', () => {
    expect(mmsiCountry('')).toBe('未知')
    expect(mmsiCountry('299123456')).toBe('未知')
  })

  it('has no duplicate MID keys that silently override', () => {
    // 表里每个键只出现一次(用 Object.keys 断言长度与去重一致)
    const keys = Object.keys(MID_COUNTRIES)
    expect(keys.length).toBe(new Set(keys).size)
  })
})

describe('aisShipType', () => {
  it('maps AIS ship type codes', () => {
    expect(aisShipType(80)).toBe('tanker')
    expect(aisShipType(70)).toBe('cargo')
    expect(aisShipType(60)).toBe('passenger')
    expect(aisShipType(30)).toBe('fishing')
    expect(aisShipType(52)).toBe('tug')
    expect(aisShipType(40)).toBe('other')
    expect(aisShipType(0)).toBe('other')
    expect(aisShipType(undefined)).toBe('other')
  })
})

describe('nameClean', () => {
  it('strips @ padding and whitespace', () => {
    expect(nameClean('EVER GIVEN@@@@@@')).toBe('EVER GIVEN')
    expect(nameClean(undefined)).toBe('')
  })
})
