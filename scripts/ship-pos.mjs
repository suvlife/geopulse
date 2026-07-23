import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
const chrome = execSync('find ' + process.env.HOME + '/.agent-browser/browsers -name "Google Chrome for Testing" -path "*/MacOS/*" | head -1').toString().trim()
const b = await puppeteer.launch({ executablePath: chrome, headless: false, args: ['--window-position=100,100', '--window-size=1440,900'] })
const pg = await b.newPage()
await pg.setViewport({ width: 1440, height: 900 })
await pg.goto('https://geopulse.guofeng.me/', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 6000))
const tabs = await pg.$$('.tab')
if (tabs[4]) await tabs[4].click()
await new Promise(r => setTimeout(r, 35000))
const res = await pg.evaluate(() => {
  const ships = window.__overlay?._props?.layers?.find(l => l.id === 'ships')?.props?.data || []
  const lons = ships.map(s => s.coord?.[0]).filter(v => v != null)
  const lats = ships.map(s => s.coord?.[1]).filter(v => v != null)
  const inMalacca = ships.filter(s => s.coord && s.coord[0] > 90 && s.coord[0] < 115 && s.coord[1] > -5 && s.coord[1] < 12).length
  return {
    total: ships.length,
    inMalacca,
    lonRange: lons.length ? [Math.min(...lons).toFixed(0), Math.max(...lons).toFixed(0)] : null,
    latRange: lats.length ? [Math.min(...lats).toFixed(0), Math.max(...lats).toFixed(0)] : null,
  }
})
console.log(JSON.stringify(res, null, 2))
await b.close()
