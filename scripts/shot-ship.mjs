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
// 等船舶数据流入(最多 60s)
let ships = 0
for (let i = 0; i < 12; i++) {
  await new Promise(r => setTimeout(r, 5000))
  ships = await pg.evaluate(() => document.querySelectorAll('.quake-row').length)
  console.log(`wait ${(i+1)*5}s: ships=${ships}`)
  if (ships > 50) break
}
await new Promise(r => setTimeout(r, 3000))
await pg.evaluate(() => { window.__animPaused = true })
await new Promise(r => setTimeout(r, 800))
await pg.screenshot({ path: '/tmp/ship-live.png' })
console.log('✓ 截图完成, ships=' + ships)
await b.close()
