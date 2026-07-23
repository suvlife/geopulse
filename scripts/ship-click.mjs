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
// 点击第一艘船
await pg.evaluate(() => document.querySelector('.quake-row')?.click())
await new Promise(r => setTimeout(r, 3000))
const res = await pg.evaluate(() => ({
  selected: document.querySelector('.detail-card .mag-badge')?.textContent.trim(),
  fields: [...document.querySelectorAll('.flight-detail-grid div')].map(e => e.textContent.trim()).join(' | '),
}))
console.log(JSON.stringify(res, null, 2))
await pg.screenshot({ path: '/tmp/ship-detail.png' })
await b.close()
