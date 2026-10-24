// 构建/开发前抓取 TLE 与 SATCAT 快照到 public/data/
// CelesTrak 的 gp.php 对高频 Origin 请求会 403/超时,快照方案:构建时拉取一次,
// 随静态站分发,用户零 CORS 零限流。CI 每 6 小时重建一次(见 deploy.yml schedule)。
//
// 新鲜度按 TLE 自身的纪元(第 1 行第 19-32 列)判断,不看文件 mtime:
// CI checkout 会把每个文件 mtime 设为当前时间,只看 mtime 会永远跳过下载,
// 导致线上长期使用几个月前的过期 TLE。
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'data')
mkdirSync(outDir, { recursive: true })

// CelesTrak 要求可识别的 UA;伪装 Chrome 会被视为规避限流
const UA = 'GeoPulse/1.0 (satellite tracker; +https://geopulse.guofeng.me)'
const TLE_FRESH_MS = 6 * 3600e3
const TLE_EXPIRE_MS = 7 * 24 * 3600e3

function tleMaxEpoch(text) {
  let max = 0
  for (const line of text.split('\n')) {
    if (!line.startsWith('1 ')) continue
    const yy = parseInt(line.slice(18, 20), 10)
    const doy = parseFloat(line.slice(20, 32))
    if (!Number.isFinite(yy) || !Number.isFinite(doy)) continue
    const year = yy < 57 ? 2000 + yy : 1900 + yy
    const ep = Date.UTC(year, 0, 1) + (doy - 1) * 864e5
    if (ep > max) max = ep
  }
  return max
}

function countRecords(text) {
  let n = 0
  for (const line of text.split('\n')) if (line.startsWith('1 ')) n++
  return n
}

const fmtAge = (ms) => {
  if (ms < 0) return `纪元超前 ${(Math.abs(ms) / 3600e3).toFixed(1)} 小时`
  if (ms < 86400e3) return `${(ms / 3600e3).toFixed(1)} 小时前`
  return `${(ms / 86400e3).toFixed(1)} 天前`
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60000),
    headers: { 'User-Agent': UA },
  })
  const text = await res.text()
  return { res, text }
}

async function fetchTle() {
  const dest = join(outDir, 'active.tle')
  const existing = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  const existingEpoch = existing ? tleMaxEpoch(existing) : 0
  const existingAge = existingEpoch ? Date.now() - existingEpoch : Infinity

  if (existing && existingAge < TLE_FRESH_MS) {
    console.log(`✓ active.tle 纪元仍新鲜(${fmtAge(existingAge)}),跳过`)
    return
  }

  const url = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'
  try {
    const { res, text } = await fetchText(url)
    if (res.status === 403) {
      // CelesTrak 对同一 UA 的重复下载返回 403 + "has not updated since..." 提示
      if (/has not updated|too many requests/i.test(text)) {
        if (existing && existingAge < TLE_EXPIRE_MS) {
          console.warn(`⚠ CelesTrak 去重:保留已有快照(${fmtAge(existingAge)})`)
          return
        }
        throw new Error(`CelesTrak 403 且本地快照已过期(${existing ? fmtAge(existingAge) : '无快照'})`)
      }
      throw new Error('CelesTrak 403')
    }
    if (!res.ok) throw new Error(`${res.status}`)
    const records = countRecords(text)
    const epoch = tleMaxEpoch(text)
    const age = Date.now() - epoch
    if (records < 1000) throw new Error(`记录数过少:${records}`)
    if (!Number.isFinite(epoch)) throw new Error('无法解析 TLE 纪元')
    if (age < -86400e3) throw new Error('TLE 纪元位于未来')
    if (age > TLE_EXPIRE_MS) throw new Error(`TLE 纪元已过期 ${fmtAge(age)}`)
    writeFileSync(dest, text)
    console.log(`✓ active.tle 已更新:${records} 条,纪元 ${new Date(epoch).toISOString()}(${fmtAge(age)})`)
  } catch (e) {
    if (existing && existingAge < TLE_EXPIRE_MS) {
      console.warn(`⚠ active.tle 拉取失败(${e.message}),使用已有快照(${fmtAge(existingAge)})`)
    } else {
      console.error(`✗ active.tle 不可用:${e.message}`)
      process.exitCode = 1
    }
  }
}

async function fetchSatcat() {
  const dest = join(outDir, 'satcat.csv')
  // SATCAT 没有逐行纪元,只能靠时间判断;但 CI 里 checkout 会把 mtime 重置为当前时间,
  // 按 mtime 判断会永远"仍新鲜"。所以 CI 的每次定时构建都直接重抓(单文件约 2.6MB)
  if (!process.env.CI && existsSync(dest) && Date.now() - statSync(dest).mtimeMs < 24 * 3600e3) {
    console.log('✓ satcat.csv 快照仍新鲜,跳过')
    return
  }
  try {
    const { res, text } = await fetchText('https://celestrak.org/pub/satcat.csv')
    if (!res.ok) throw new Error(`${res.status}`)
    if (text.length < 1e6) throw new Error(`content too small: ${text.length}`)
    writeFileSync(dest, text)
    console.log(`✓ satcat.csv 已更新 (${(text.length / 1024 / 1024).toFixed(1)}MB)`)
  } catch (e) {
    if (existsSync(dest)) {
      console.warn(`⚠ satcat.csv 拉取失败(${e.message}),使用已有快照`)
    } else {
      console.error(`✗ satcat.csv 拉取失败且无快照:${e.message}`)
      process.exitCode = 1
    }
  }
}

await fetchTle()
await fetchSatcat()
