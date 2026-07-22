// 开发辅助:用 puppeteer-core 截取页面两个模式的截图
// 用法: node scripts/screenshot.mjs [输出目录]
// 注:页面有持续 WebGL 动画,截图前需冻结 rAF,否则 CDP 等不到稳定帧
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'

const outDir = process.argv[2] || '/tmp'
const chromePath = execSync(
  `find ${process.env.HOME}/.agent-browser/browsers -name "Google Chrome for Testing" -path "*/MacOS/*" | head -1`
).toString().trim()

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: false, // macOS 无头模式下 WebGL 页面 captureScreenshot 会挂起
  args: ['--window-size=1440,900', '--hide-scrollbars', '--window-position=100,100'],
  defaultViewport: { width: 1440, height: 900 },
  protocolTimeout: 90000,
})

const page = await browser.newPage()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const freeze = () => page.evaluate(() => {
  window.__realRaf ||= window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = () => 0
})
const unfreeze = () => page.evaluate(() => {
  if (window.__realRaf) window.requestAnimationFrame = window.__realRaf
})

async function shot(name) {
  await page.evaluate(() => { window.__animPaused = true })
  await sleep(800)
  await page.screenshot({ path: `${outDir}/${name}.png` })
  console.log(`✓ ${name} 截图完成`)
  await page.evaluate(() => { window.__animPaused = false })
}

await page.goto('https://geopulse.guofeng.me/', { waitUntil: 'networkidle2', timeout: 60000 })
// 等 CF JS Challenge 完成(有 headless 检测时最多 15s)
await sleep(15000)
await shot('shot-typhoon')

await page.evaluate(() => document.querySelectorAll(".tab")[4]?.click())
await sleep(10000)
await shot('shot-ship')

await browser.close()
