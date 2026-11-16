/**
 * 土派（Tapa）—— 从题面图片自动识别并导入题库
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [选项]
 *
 * 选项：
 *   --name 名称        题库中显示的名称（默认：识图 · W×H）
 *   --id ID            指定题目 id
 *   --series 系列      系列名（默认：图片导入）
 *   --difficulty 级别  easy / medium / hard / custom（默认 hard）
 *   --size N           正方形网格边长（自动识别失败时手动指定）
 *   --width N / --height N  非正方形题图的宽/高，可只给一边
 *   --map r,c=数字串   人工覆盖某格线索（行列从 1 开始；数字串每个字符是一段，
 *                      例如 --map 3,4=122 表示 (1,2,2)，--map 3,4=0 表示清空）
 *   --append           写入 src/game/imported-puzzles.ts
 *   --verify           唯一性检查（大网格可能超时，会给出警告）
 *   --dry              只识别线索，不求解、不写入
 *   --timeout MS       求解时间上限毫秒（默认 180000，大型 35×35 题需要更久）
 *   --max-nodes N      求解节点上限（默认 3000000）
 *   --edge PATH        指定 Edge 可执行文件路径（默认自动探测）
 *
 * 识别原理（Playwright + Edge，无网络、无外部服务）：
 *   1. 投影深色像素得到网格线，取最长等距线序列，得到网格尺寸；
 *   2. 每格内做 8 连通域，得到数字字形；用多套系统无衬线字体渲染 0-9 模板做 IoU 匹配；
 *   3. 同一格内数字先按行（y）再按列（x）排序，得到站点显示的线索顺序；
 *   4. 每个线索格用「循环等价」的方式求解（Tapa 线索顺序本身是循环的，先后次序不分），
 *      用求出的解把每个线索旋转成项目引擎从 N 起算的规范方向，从而写出可正常游玩的题面；
 *   5. 预览 / --append 写入题库，--verify 用项目求解器再检查唯一性。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { register } from 'node:module'

// ───────────────────── 让 Node 能直接 import 项目里的 .ts ─────────────────────
const tsResolveLoader = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) } catch (err) {
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
      try { return await next(specifier + '.ts', context) } catch {}
    }
    throw err
  }
}`
register('data:text/javascript;base64,' + Buffer.from(tsResolveLoader).toString('base64'))

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function resolveEdge() {
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p
  throw new Error('找不到 Microsoft Edge，可用 --edge 或环境变量 EDGE_PATH 指定路径')
}

const DATA_FILE = path.resolve('src/game/imported-puzzles.ts')
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

function usage(message) {
  if (message) console.error(`[import] ${message}`)
  console.error(
    '用法: node scripts/import-image.mjs <图片路径> [--name 名称] [--series 系列] [--difficulty easy|medium|hard|custom]\n' +
      '       [--size N | --width N --height N] [--map r,c=数字串] [--append] [--verify] [--dry]\n' +
      '       [--timeout MS] [--max-nodes N] [--id ID] [--edge PATH]',
  )
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {
    positional: [],
    append: false,
    verify: false,
    dry: false,
    size: 0,
    width: 0,
    height: 0,
    timeout: 180_000,
    maxNodes: 3_000_000,
    map: [],
  }
  const valueFlags = new Set(['name', 'id', 'series', 'difficulty', 'size', 'width', 'height', 'timeout', 'max-nodes', 'edge', 'map'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      opts.positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (key === 'append') opts.append = true
    else if (key === 'verify') opts.verify = true
    else if (key === 'dry') opts.dry = true
    else if (valueFlags.has(key)) {
      const value = argv[i + 1]
      if (value === undefined) usage(`缺少 --${key} 的值`)
      i++
      if (key === 'max-nodes') opts.maxNodes = Number(value)
      else if (key === 'timeout') opts.timeout = Number(value)
      else if (key === 'size') opts.size = Number(value)
      else if (key === 'width') opts.width = Number(value)
      else if (key === 'height') opts.height = Number(value)
      else if (key === 'map') opts.map.push(value)
      else opts[key] = value
    } else usage(`未知选项 --${key}`)
  }
  if (opts.positional.length !== 1) usage('需要且只需要一个图片路径')
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) usage('--timeout 必须是正数')
  if (!Number.isFinite(opts.maxNodes) || opts.maxNodes <= 0) usage('--max-nodes 必须是正数')
  return opts
}

function hashId(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 6)
}

function encodeClues(clues) {
  let out = ''
  for (const v of clues) out += v > 0 && v < BASE36.length ? BASE36[v] : '0'
  return out
}

// ───────────────────────────── 图片识别 ─────────────────────────────

function dataUrlOf(file) {
  const ext = path.extname(file).toLowerCase()
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.bmp'
        ? 'image/bmp'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/jpeg'
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

async function analyzeImage({ imageFile, edge, size, width, height }) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ headless: true, executablePath: edge })
  try {
    const page = await browser.newPage()
    return await page.evaluate(
      async ({ src, sizeOpt, widthOpt, heightOpt }) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const W = img.naturalWidth
        const H = img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, W, H).data
        const lum = new Float32Array(W * H)
        for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
          lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        }
        const inkAt = (x, y) => lum[y * W + x] < 128

        const groupLines = (scores, min) => {
          const out = []
          let run = []
          for (let i = 0; i < scores.length; i++) {
            if (scores[i] >= min) run.push(i)
            else if (run.length) {
              out.push(run.reduce((a, b) => a + b, 0) / run.length)
              run = []
            }
          }
          if (run.length) out.push(run.reduce((a, b) => a + b, 0) / run.length)
          return out
        }
        const longestRun = (lines) => {
          let best = []
          for (let i = 0; i < lines.length; i++) {
            for (let j = i + 1; j < lines.length; j++) {
              const step = (lines[j] - lines[i]) / (j - i)
              if (step < 6) continue
              const run = [lines[i]]
              let expected = lines[i] + step
              let k = i + 1
              while (k < lines.length && Math.abs(lines[k] - expected) <= step * 0.25) {
                run.push(lines[k])
                k++
                expected += step
              }
              if (run.length > best.length) best = run
            }
          }
          if (best.length < 3) return null
          return { first: best[0], last: best[best.length - 1], step: (best[best.length - 1] - best[0]) / (best.length - 1), lines: best.length }
        }

        const rowScore = new Int32Array(H)
        const colScore = new Int32Array(W)
        for (let y = 0; y < H; y++) {
          let n = 0
          for (let x = 0; x < W; x++) if (lum[y * W + x] < 120) n++
          rowScore[y] = n
        }
        for (let x = 0; x < W; x++) {
          let n = 0
          for (let y = 0; y < H; y++) if (lum[y * W + x] < 120) n++
          colScore[x] = n
        }
        const maxRow = Math.max(...rowScore)
        const maxCol = Math.max(...colScore)
        const hLines = longestRun(groupLines(rowScore, maxRow * 0.5))
        const vLines = longestRun(groupLines(colScore, maxCol * 0.5))
        if (!hLines || !vLines) {
          return { error: '未能定位网格线；请确认图片包含完整的题面网格，或先用 --size / --width / --height 指定尺寸' }
        }
        const autoW = vLines.lines - 1
        const autoH = hLines.lines - 1
        const w = widthOpt || sizeOpt || autoW
        const h = heightOpt || sizeOpt || autoH
        if (!(w >= 2) || !(h >= 2)) {
          return { error: `无法确定网格尺寸：竖线 ${vLines.lines} 条、横线 ${hLines.lines} 条（自动识别 ${autoW}×${autoH}）` }
        }
        if (vLines.lines !== w + 1 || hLines.lines !== h + 1) {
          return {
            error:
              `网格不匹配：识别到 ${vLines.lines} 条竖线 / ${hLines.lines} 条横线，` +
              `但目标是 ${w}×${h}（需要 ${w + 1} / ${h + 1} 条线）`,
          }
        }
        const x0 = vLines.first
        const y0 = hLines.first
        const cellW = vLines.step
        const cellH = hLines.step
        const cellMin = Math.min(cellW, cellH)

        // —— 数字模板（多套无衬线字体，取匹配最好者）——
        const N = 12
        const templates = {}
        const fonts = ['bold 60px Arial', 'bold 60px Helvetica', 'bold 60px "Segoe UI"', 'bold 60px Verdana', 'bold 60px Tahoma', 'bold 60px "Microsoft YaHei"']
        const tcv = document.createElement('canvas')
        tcv.width = 96
        tcv.height = 96
        const tg = tcv.getContext('2d', { willReadFrequently: true })
        const normRaw = (raw, rw, rh) => {
          let bx0 = rw, bx1 = -1, by0 = rh, by1 = -1
          for (let y = 0; y < rh; y++)
            for (let x = 0; x < rw; x++)
              if (raw[y * rw + x]) {
                if (x < bx0) bx0 = x
                if (x > bx1) bx1 = x
                if (y < by0) by0 = y
                if (y > by1) by1 = y
              }
          if (bx1 < 0) return null
          const bw = bx1 - bx0 + 1
          const bh = by1 - by0 + 1
          const out = new Uint8Array(N * N)
          for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++) {
              const sx = bx0 + Math.min(bw - 1, Math.floor((bw * i) / N))
              const sy = by0 + Math.min(bh - 1, Math.floor((bh * j) / N))
              out[j * N + i] = raw[sy * rw + sx]
            }
          return out
        }
        for (const font of fonts) {
          const list = {}
          for (let d = 0; d <= 9; d++) {
            tg.fillStyle = '#fff'
            tg.fillRect(0, 0, 96, 96)
            tg.fillStyle = '#000'
            tg.font = font
            tg.textAlign = 'center'
            tg.textBaseline = 'middle'
            tg.fillText(String(d), 48, 48)
            const id = tg.getImageData(0, 0, 96, 96).data
            const raw = new Uint8Array(96 * 96)
            for (let p = 0; p < raw.length; p++) raw[p] = id[p * 4] < 128 ? 1 : 0
            const norm = normRaw(raw, 96, 96)
            if (norm) list[d] = norm
          }
          templates[font] = list
        }
        const iou = (a, b) => {
          let inter = 0
          let union = 0
          for (let i = 0; i < a.length; i++) {
            if (a[i] && b[i]) inter++
            if (a[i] || b[i]) union++
          }
          return union ? inter / union : 0
        }
        const classifyDigit = (norm) => {
          let bestDigit = -1
          let bestScore = 0
          for (const font of fonts) {
            const list = templates[font]
            for (let d = 0; d <= 9; d++) {
              const s = iou(norm, list[d])
              if (s > bestScore) {
                bestScore = s
                bestDigit = d
              }
            }
          }
          return { digit: bestDigit, score: bestScore }
        }

        // —— 逐格提取数字连通域 ——
        const seen = new Uint8Array(W * H)
        const cells = new Array(w * h).fill(null)
        const uncertain = []
        let clueCells = 0
        let digitCount = 0
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const gx0 = x0 + c * cellW
            const gy0 = y0 + r * cellH
            const margin = Math.max(2, cellMin * 0.1)
            const comps = []
            for (let y = Math.ceil(gy0 + margin); y <= Math.floor(gy0 + cellH - margin); y++) {
              for (let x = Math.ceil(gx0 + margin); x <= Math.floor(gx0 + cellW - margin); x++) {
                const k = y * W + x
                if (!inkAt(x, y) || seen[k]) continue
                let n = 0
                let minX = x
                let maxX = x
                let minY = y
                let maxY = y
                const stack = [k]
                seen[k] = 1
                const pixels = []
                while (stack.length) {
                  const cur = stack.pop()
                  const px = cur % W
                  const py = (cur / W) | 0
                  n++
                  pixels.push(cur)
                  if (px < minX) minX = px
                  if (px > maxX) maxX = px
                  if (py < minY) minY = py
                  if (py > maxY) maxY = py
                  for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                      if (!dx && !dy) continue
                      const nx = px + dx
                      const ny = py + dy
                      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
                      const nk = ny * W + nx
                      if (lum[nk] < 128 && !seen[nk]) {
                        seen[nk] = 1
                        stack.push(nk)
                      }
                    }
                }
                if (n < Math.max(6, cellMin * cellMin * 0.01)) continue
                const bw = maxX - minX + 1
                const bh = maxY - minY + 1
                const local = new Uint8Array(bw * bh)
                for (const cur of pixels) {
                  const px = cur % W
                  const py = (cur / W) | 0
                  local[(py - minY) * bw + (px - minX)] = 1
                }
                const norm = normRaw(local, bw, bh)
                if (!norm) continue
                const cls = classifyDigit(norm)
                comps.push({ x: minX, y: minY, w: bw, h: bh, n, digit: cls.digit, score: cls.score })
              }
            }
            if (!comps.length) continue
            comps.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.5 ? a.y - b.y : a.x - b.x))
            const seq = comps.map((c2) => c2.digit)
            cells[r * w + c] = { seq, comps }
            clueCells++
            digitCount += seq.length
            for (const comp of comps) if (comp.score < 0.55) uncertain.push({ r, c, digit: comp.digit, score: +comp.score.toFixed(2) })
          }
        }

        return {
          width: w,
          height: h,
          cells,
          clueCells,
          digitCount,
          uncertain,
          grid: { imageW: W, imageH: H, x0, y0, cellW, cellH, autoW, autoH },
        }
      },
      { src: dataUrlOf(imageFile), sizeOpt: size, widthOpt: width, heightOpt: height },
    )
  } finally {
    await browser.close()
  }
}

// ──────────────────────── Tapa 循环语义求解（用于方向归一化） ────────────────────────

async function loadPatterns() {
  const types = await import('../src/game/types.ts')
  return types
}

function parsePatterns(types) {
  return types.PATTERNS
}

function isRotationOfRuns(runs, pattern) {
  if (runs.length !== pattern.length) return false
  for (let k = 0; k < pattern.length; k++) {
    let ok = true
    for (let i = 0; i < pattern.length; i++) {
      const want = pattern[(i + k) % pattern.length]
      if (runs[i] !== want) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

/** 某线索在「顺序不分」意义上的全部 8 邻黑格掩码 */
function cyclicMasks(patterns, code, index, w, h, types, cache) {
  const avail = types.availMask(index, w, h)
  const key = code + ':' + avail
  const hit = cache.get(key)
  if (hit) return hit
  const pattern = patterns[code - 1]
  const out = []
  if (pattern) {
    for (let mask = 0; mask < 256; mask++) {
      if ((mask & ~avail) !== 0) continue
      if (isRotationOfRuns(types.blackRuns(mask, avail), pattern)) out.push(mask)
    }
  }
  cache.set(key, out)
  return out
}

function makeCyclicSolver(types) {
  const patterns = parsePatterns(types)
  const maskCache = new Map()

  const propagate = (grid, clues, w, h) => {
    const n = w * h
    let changed = true
    const set = (i, v) => {
      if (grid[i] === v) return true
      if (grid[i] !== 0) return false
      grid[i] = v
      changed = true
      return true
    }
    for (let i = 0; i < n; i++) {
      if (clues[i] > 0) {
        if (grid[i] === 1) return false
        if (grid[i] === 0 && !set(i, 2)) return false
      }
    }
    while (changed) {
      changed = false
      for (let i = 0; i < n; i++) {
        const code = clues[i]
        if (code <= 0) continue
        const masks = cyclicMasks(patterns, code, i, w, h, types, maskCache)
        if (!masks.length) return false
        const list = types.neighbors8(i, w, h)
        const consistent = []
        for (const mask of masks) {
          let ok = true
          for (let d = 0; d < 8; d++) {
            const cell = list[d]
            if (cell < 0) continue
            if (grid[cell] === 1 && !(mask & (1 << d))) ok = false
            if (grid[cell] === 2 && mask & (1 << d)) ok = false
          }
          if (ok) consistent.push(mask)
        }
        if (!consistent.length) return false
        let inter = 0xff
        let union = 0
        for (const mask of consistent) {
          inter &= mask
          union |= mask
        }
        for (let d = 0; d < 8; d++) {
          const cell = list[d]
          if (cell < 0 || grid[cell] !== 0) continue
          if (inter & (1 << d)) {
            if (!set(cell, 1)) return false
          } else if (!(union & (1 << d))) {
            if (!set(cell, 2)) return false
          }
        }
      }
      for (let y = 0; y + 1 < h; y++) {
        for (let x = 0; x + 1 < w; x++) {
          const a = y * w + x
          const b = a + 1
          const cc = a + w
          const dd = cc + 1
          let black = 0
          let unknown = -1
          for (const q of [a, b, cc, dd]) {
            if (grid[q] === 1) black++
            else if (grid[q] === 0) unknown = q
          }
          if (black === 4) return false
          if (unknown >= 0 && black === 3 && !set(unknown, 2)) return false
        }
      }
      const seenB = new Uint8Array(n)
      const comps = []
      for (let s = 0; s < n; s++) {
        if (grid[s] !== 1 || seenB[s]) continue
        const comp = []
        const stack = [s]
        seenB[s] = 1
        while (stack.length) {
          const i = stack.pop()
          comp.push(i)
          const x = i % w
          const y = (i / w) | 0
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const j = ny * w + nx
            if (!seenB[j] && grid[j] === 1) {
              seenB[j] = 1
              stack.push(j)
            }
          }
        }
        comps.push(comp)
      }
      if (comps.length > 1) {
        for (const comp of comps) {
          let can = false
          for (const i of comp) {
            const x = i % w
            const y = (i / w) | 0
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
              if (grid[ny * w + nx] === 0) {
                can = true
                break
              }
            }
            if (can) break
          }
          if (!can) return false
        }
      }
    }
    return true
  }

  const solve = (clues, w, h, limit, maxNodes, timeoutMs) => {
    const size = w * h
    const grid = new Int8Array(size)
    for (let i = 0; i < size; i++) if (clues[i] > 0) grid[i] = 2
    const solutions = []
    let nodes = 0
    let timedOut = false
    const deadline = Date.now() + timeoutMs
    const dfs = () => {
      if (solutions.length >= limit || timedOut) return
      if ((nodes & 255) === 0 && Date.now() > deadline) {
        timedOut = true
        return
      }
      nodes++
      if (nodes > maxNodes) {
        timedOut = true
        return
      }
      if (!propagate(grid, clues, w, h)) return
      let best = -1
      let bestScore = -1
      for (let i = 0; i < size; i++) {
        if (grid[i] !== 0) continue
        let score = 0
        const x = i % w
        const y = (i / w) | 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          if (grid[ny * w + nx] !== 0) score++
        }
        if (score > bestScore) {
          bestScore = score
          best = i
        }
      }
      if (best < 0) {
        solutions.push(Array.from(grid))
        return
      }
      const backup = Int8Array.from(grid)
      for (const v of [1, 2]) {
        grid[best] = v
        dfs()
        grid.set(backup)
        if (solutions.length >= limit || timedOut) return
      }
    }
    dfs()
    return { solutions, nodes, timedOut }
  }
  return { solve }
}

/** 用解把每个线索旋转成项目引擎的规范方向（从 N 起算首个白格之后） */
function canonicalize(types, clueSeqs, solution, w, h) {
  const clues = new Array(w * h).fill(0)
  const bad = []
  for (let i = 0; i < w * h; i++) {
    const seq = clueSeqs[i]
    if (!seq) continue
    const list = types.neighbors8(i, w, h)
    let mask = 0
    for (let d = 0; d < 8; d++) {
      const cell = list[d]
      if (cell >= 0 && solution[cell] === 1) mask |= 1 << d
    }
    const runs = types.blackRuns(mask, types.availMask(i, w, h))
    const code = types.clueCodeForRuns(runs)
    if (code > 0) clues[i] = code
    else bad.push({ r: Math.floor(i / w), c: i % w, seq, runs })
  }
  return { clues, bad }
}

// ───────────────────────────── 写入题库 ─────────────────────────────

function appendEntry(entry) {
  const line = `  { id: ${JSON.stringify(entry.id)}, name: ${JSON.stringify(entry.name)}, width: ${entry.width}, height: ${entry.height}, difficulty: '${entry.difficulty}', series: ${JSON.stringify(entry.series)}, board: ${JSON.stringify(entry.board)}, solution: ${JSON.stringify(entry.solution ?? '')} },\n`
  if (!existsSync(DATA_FILE)) {
    writeFileSync(
      DATA_FILE,
      "import type { RawPuzzle } from './puzzles-data'\n\n/** 由 scripts/import-image.mjs 追加；不会在 npm run gen 时被覆盖 */\nexport const IMPORTED_PUZZLES: RawPuzzle[] = [\n" +
        line +
        ']\n',
      'utf8',
    )
    return
  }
  let text = readFileSync(DATA_FILE, 'utf8').replace(/\r\n/g, '\n')
  const close = text.lastIndexOf(']')
  if (close < 0) throw new Error('imported-puzzles.ts 格式异常：找不到数组结尾 ]')
  const before = text.slice(0, close)
  text = before + (before.endsWith('\n') ? '' : '\n') + line + text.slice(close)
  writeFileSync(DATA_FILE, text, 'utf8')
}

// ───────────────────────────── 主流程 ─────────────────────────────

const opts = parseArgs(process.argv.slice(2))
const imageFile = path.resolve(opts.positional[0])
if (!existsSync(imageFile)) usage(`找不到图片：${imageFile}`)
const edge = opts.edge || resolveEdge()
const types = await loadPatterns()
const patterns = parsePatterns(types)

console.log(`[import] 识别 ${path.relative(process.cwd(), imageFile) || imageFile}`)
const detected = await analyzeImage({ imageFile, edge, size: opts.size, width: opts.width, height: opts.height })
if (detected.error) {
  console.error(`[import] ${detected.error}`)
  process.exit(1)
}
const { width, height, grid } = detected
const size = width * height
const seqs = detected.cells.map((cell) => (cell ? cell.seq.slice() : null))

// --map 人工覆盖：r,c=数字串（行列从 1 开始；每个字符是一段，0 表示无数字）
for (const spec of opts.map) {
  for (const pair of spec.split(';')) {
    if (!pair.trim()) continue
    const m = pair.trim().match(/^(\d+)\s*,\s*(\d+)\s*=\s*([0-9]*)$/)
    if (!m) usage(`--map 格式应为 行,列=数字串（如 3,4=122 或 3,4=0），收到：${pair}`)
    const r = Number(m[1]) - 1
    const c = Number(m[2]) - 1
    if (r < 0 || r >= height || c < 0 || c >= width) usage(`--map 坐标越界：${pair}（网格 ${width}×${height}）`)
    const digits = m[3]
    seqs[r * width + c] = digits === '' || digits === '0' ? null : digits.split('').map(Number)
  }
}

// 校验每条线索是合法 Tapa 序列（任意旋转能在模式表里找到）
const invalidSeqs = []
for (let i = 0; i < size; i++) {
  const seq = seqs[i]
  if (!seq) continue
  let ok = false
  for (let k = 0; k < seq.length; k++) {
    const rot = seq.slice(k).concat(seq.slice(0, k))
    if (types.clueCodeForRuns(rot) > 0) {
      ok = true
      break
    }
  }
  if (!ok) invalidSeqs.push({ r: Math.floor(i / width) + 1, c: (i % width) + 1, seq })
}
if (invalidSeqs.length) {
  console.error('[import] 以下线索不是合法 Tapa 模式（可用 --map 修正）：')
  for (const bad of invalidSeqs.slice(0, 20)) console.error(`  第 ${bad.r} 行第 ${bad.c} 列：${bad.seq.join(',')}`)
  process.exit(1)
}

console.log(
  `[import] 网格 ${width}×${height}，格子 ${grid.cellW.toFixed(2)}×${grid.cellH.toFixed(2)}px，` +
    `图片 ${grid.imageW}×${grid.imageH}；线索格 ${detected.clueCells}，数字 ${detected.digitCount}`,
)
if (detected.uncertain.length) {
  console.warn(`[import] 有 ${detected.uncertain.length} 个数字字形识别把握不足（可用 --map 修正）：`)
  for (const u of detected.uncertain.slice(0, 12)) {
    console.warn(`  第 ${u.r + 1} 行第 ${u.c + 1} 列：数字 ${u.digit}（相似度 ${u.score}）`)
  }
}

const printSeq = (seq) => (seq ? seq.join('') : '.')
console.log('[import] 线索（. = 无数字；多段数字按站点显示顺序给出）：')
for (let r = 0; r < height; r++) {
  const line = []
  for (let c = 0; c < width; c++) line.push(printSeq(seqs[r * width + c]).padStart(3))
  console.log(String(r + 1).padStart(2) + ' ' + line.join(''))
}
if (opts.dry) {
  console.log('[import] --dry：仅识别，不求解、不写入。')
  process.exit(0)
}

// Tapa 线索本身「先后次序不分」，站点显示顺序与项目引擎的规范方向可能不同：
// 先用循环语义求解，再用解把线索旋转成规范方向，才能被项目引擎正确解释。
const cluesForSolve = new Array(size).fill(0)
for (let i = 0; i < size; i++) {
  const seq = seqs[i]
  if (!seq) continue
  for (let k = 0; k < seq.length; k++) {
    const rot = seq.slice(k).concat(seq.slice(0, k))
    const code = types.clueCodeForRuns(rot)
    if (code > 0) {
      cluesForSolve[i] = code
      break
    }
  }
}
console.log(`[import] 循环语义求解（时间上限 ${opts.timeout}ms；大型题图较慢）…`)
const solver = makeCyclicSolver(types)
const tSolve = Date.now()
const solved = solver.solve(cluesForSolve, width, height, opts.verify ? 2 : 1, opts.maxNodes, opts.timeout)
const solution = solved.solutions[0] ?? null
if (!solution) {
  console.error(
    `[import] 求解失败（${solved.timedOut ? '超时' : '无解'}，${solved.nodes} 节点 / ${Date.now() - tSolve}ms）。` +
      '可用 --timeout / --max-nodes 放宽，或先用 --map 修正识别错误的线索。',
  )
  process.exit(1)
}
const unique = solved.solutions.length === 1 && !solved.timedOut && opts.verify
console.log(
  `[import] ${unique ? '唯一解' : solved.timedOut ? '已求出一个解（搜索超时，唯一性未确认）' : `已求出参考解（解数 ${solved.solutions.length}）`}，` +
    `${solved.nodes} 节点 / ${Date.now() - tSolve}ms`,
)
if (!unique) console.warn('[import] 警告：没有确认唯一解；如需检查唯一性请加 --verify（大图可能需要放宽 --timeout）。')

const canonical = canonicalize(types, seqs, solution, width, height)
if (canonical.bad.length) {
  console.error('[import] 以下线索的规范方向不在模式表里（需要补充 PATTERNS）：')
  for (const bad of canonical.bad.slice(0, 20)) console.error(`  第 ${bad.r + 1} 行第 ${bad.c + 1} 列：${JSON.stringify(bad.runs)}`)
  process.exit(1)
}
const board = encodeClues(canonical.clues)
const solutionText = solution.map((v) => (v === 1 ? '1' : '2')).join('')
const displayedBoardCodes = seqs.map((seq) => (seq ? types.clueCodeForRuns(seq) : 0))
const reordered = displayedBoardCodes.some((code, i) => code !== canonical.clues[i])

// 项目引擎自检：规范方向题面 + 解必须通过 isValidSolution
if (opts.verify) {
  const rules = await import('../src/game/rules.ts')
  const solverMod = await import('../src/game/solver.ts')
  const ok = rules.isValidSolution(solution, canonical.clues, width, height)
  console.log(`[import] 参考解与规范题面一致：${ok ? '是' : '否'}`)
  if (!ok) {
    console.error('[import] 参考解校验失败，拒绝写入')
    process.exit(1)
  }
  console.log('[import] 项目求解器唯一性检查（35×35 这类大图可能超时）…')
  const counted = solverMod.countSolutions(canonical.clues, size, width, height, 2, opts.maxNodes)
  if (counted.timedOut) {
    console.warn(`[import] 唯一性检查超时（${counted.nodes} 节点），已确认的参考解仍然有效。`)
  } else if (counted.count === 1) {
    console.log(`[import] 唯一解确认（${counted.nodes} 节点）`)
  } else {
    console.warn(`[import] 警告：项目引擎下解数为 ${counted.count}，题目可能不唯一。`)
  }
}

const id = opts.id || `tapa-${width}x${height}-${hashId(board)}`
const name = opts.name || `识图 · ${width}×${height}`
const difficulty = opts.difficulty || 'hard'
const series = opts.series || '图片导入'
const entry = { id, name, width, height, difficulty, series, board, solution: solutionText }

if (!opts.append) {
  console.log('[import] 预览模式（未写入题库）。加 --append 写入 src/game/imported-puzzles.ts。')
  console.log(
    `[import] 题库条目：id=${id} name=${name} 尺寸=${width}×${height} 线索=${canonical.clues.filter((c) => c > 0).length}` +
      ` 参考解=${solutionText.length} 格` +
      (reordered ? '（线索已按项目引擎的规范方向重排）' : ''),
  )
  console.log(`[import] board = ${board}`)
} else {
  appendEntry(entry)
  console.log(`[import] 已写入 ${path.relative(process.cwd(), DATA_FILE)}：${id} ${name}`)
}
