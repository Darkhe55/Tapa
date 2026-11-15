/**
 * 土派题库生成器
 *
 * 1. 随机生长一团连通黑格（始终不出现 2×2 全黑）；
 * 2. 对每个白格计算 8 邻黑段模式，能映射到模式表的就作为数字；
 * 3. 随机移除仍保持唯一解的数字。
 */

import type { Difficulty } from '../core/types'
import {
  BLACK,
  blackRuns,
  availMask,
  clueCodeForRuns,
  encodeCells,
  encodeClues,
  neighbors8,
  WHITE,
} from './types.ts'
import { countSolutions } from './solver.ts'

interface GenSpec {
  w: number
  h: number
  blacks: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function creates2x2(cells: number[], w: number, h: number, cell: number): boolean {
  const x = cell % w
  const y = (cell / w) | 0
  for (const [ox, oy] of [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ] as const) {
    const qx = x + ox
    const qy = y + oy
    if (qx < 0 || qy < 0 || qx + 1 >= w || qy + 1 >= h) continue
    const a = qy * w + qx
    if (
      cells[a] === BLACK &&
      cells[a + 1] === BLACK &&
      cells[a + w] === BLACK &&
      cells[a + w + 1] === BLACK
    ) {
      return true
    }
  }
  return false
}

function makeBlack(rng: () => number, w: number, h: number, target: number): number[] {
  const cells = new Array<number>(w * h).fill(WHITE)
  let start = Math.floor(rng() * (w * h))
  cells[start] = BLACK
  let count = 1
  let guard = 0
  while (count < target && guard++ < 5000) {
    const frontier: number[] = []
    for (let i = 0; i < w * h; i++) {
      if (cells[i] !== BLACK) continue
      const x = i % w
      const y = (i / w) | 0
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < w ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
      ]) {
        if (n >= 0 && cells[n] === WHITE) frontier.push(n)
      }
    }
    if (!frontier.length) break
    const next = frontier[Math.floor(rng() * frontier.length)]!
    cells[next] = BLACK
    if (creates2x2(cells, w, h, next)) cells[next] = WHITE
    else count++
  }
  return cells
}

function deriveClues(cells: number[], w: number, h: number): number[] {
  const clues = new Array<number>(w * h).fill(0)
  for (let i = 0; i < w * h; i++) {
    if (cells[i] !== WHITE) continue
    const list = neighbors8(i, w, h)
    let mask = 0
    for (let d = 0; d < 8; d++) {
      const cell = list[d]!
      if (cell >= 0 && cells[cell] === BLACK) mask |= 1 << d
    }
    const runs = blackRuns(mask, availMask(i, w, h))
    const code = clueCodeForRuns(runs)
    if (code > 0) clues[i] = code
  }
  return clues
}

const SPECS: GenSpec[] = [
  { w: 8, h: 8, blacks: 18, seed: 0x4d535401, difficulty: 'easy', name: '初识土派', series: '入门' },
  { w: 8, h: 8, blacks: 20, seed: 0x4d535402, difficulty: 'easy', name: '黑段初现', series: '入门' },
  { w: 8, h: 8, blacks: 22, seed: 0x4d535403, difficulty: 'medium', name: '连续黑带', series: '进阶' },
  { w: 8, h: 8, blacks: 24, seed: 0x4d535404, difficulty: 'medium', name: '土派迷宫', series: '进阶' },
  { w: 8, h: 8, blacks: 26, seed: 0x4d535405, difficulty: 'hard', name: '土派之壁', series: '挑战' },
  { w: 8, h: 8, blacks: 28, seed: 0x4d535406, difficulty: 'hard', name: '终局土派', series: '挑战' },
]

export interface GeneratedPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

function attempt(spec: GenSpec, rng: () => number): GeneratedPuzzle | null {
  const w = spec.w
  const h = spec.h
  const size = w * h
  const cells = makeBlack(rng, w, h, spec.blacks)
  const blackCount = cells.filter((v) => v === BLACK).length
  if (blackCount < Math.floor(spec.blacks * 0.7)) return null

  const clues = deriveClues(cells, w, h)
  let hasClue = false
  for (const c of clues) if (c > 0) hasClue = true
  if (!hasClue) return null

  let counted = countSolutions(clues, size, w, h, 2, 300_000)
  if (counted.timedOut || counted.count !== 1) return null

  const order = shuffle(
    Array.from({ length: size }, (_, i) => i).filter((i) => clues[i]! > 0),
    rng,
  )
  for (const i of order) {
    const save = clues[i]!
    clues[i] = 0
    counted = countSolutions(clues, size, w, h, 2, 300_000)
    if (counted.timedOut) {
      clues[i] = save
      break
    }
    if (counted.count === 1) continue
    clues[i] = save
  }

  return {
    id: `tapa-${w}x${h}-${spec.seed.toString(36)}`,
    name: spec.name,
    width: w,
    height: h,
    difficulty: spec.difficulty,
    series: spec.series,
    board: encodeClues(clues),
    solution: encodeCells(cells),
  }
}

export function generatePuzzles(): GeneratedPuzzle[] {
  const out: GeneratedPuzzle[] = []
  for (const spec of SPECS) {
    const t0 = Date.now()
    const rng = mulberry32(spec.seed)
    let made: GeneratedPuzzle | null = null
    for (let tries = 0; tries < 300 && !made; tries++) made = attempt(spec, rng)
    if (!made) throw new Error(`[土派 gen] ${spec.name} 生成失败`)
    const clueCount = made.board.split('').filter((c) => c !== '0').length
    console.log(`[土派 gen] ${spec.name}：数字 ${clueCount}，${Date.now() - t0}ms`)
    out.push(made)
  }
  return out
}
