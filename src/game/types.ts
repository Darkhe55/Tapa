/**
 * 土派（Tapa）—— 游戏专用类型
 *
 * 0 = 未定，1 = 黑格，2 = 白格。
 * clues[i] = 0 无数字；否则为「连续黑段长度模式」编号（1..PATTERNS.length）。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export const PATTERNS: number[][] = [
  [1], [2], [3], [4], [5],
  [1, 1], [1, 2], [2, 1], [1, 3], [3, 1],
  [1, 4], [4, 1], [1, 5], [5, 1], [2, 2],
  [2, 3], [3, 2], [2, 4], [4, 2], [3, 3],
  [1, 1, 1], [1, 1, 2], [2, 1, 1], [1, 2, 1],
  [1, 1, 3], [3, 1, 1], [1, 3, 1], [2, 2, 1], [1, 2, 2],
  // 以下为图片导入补充：真实题图会出现 6/7/8 单段与四段 (1,1,1,1)，
  // 以及方向归一化（把线索旋转到从 N 起算的首个白格之后）需要的旋转 [2,1,2]。
  // 追加在末尾，不影响已有题目的编码。
  [6], [7], [8], [1, 1, 1, 1], [2, 1, 2],
]

/** 8 邻方向：N, NE, E, SE, S, SW, W, NW */
export const DIRS: Array<[number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
]

export function patternRuns(code: number): number[] | null {
  if (code <= 0 || code > PATTERNS.length) return null
  return PATTERNS[code - 1]!
}

export function clueCodeForRuns(runs: number[]): number {
  for (let i = 0; i < PATTERNS.length; i++) {
    const p = PATTERNS[i]!
    if (p.length !== runs.length) continue
    let same = true
    for (let j = 0; j < p.length; j++) if (p[j] !== runs[j]) same = false
    if (same) return i + 1
  }
  return 0
}

/** 8 邻格索引，-1 表示棋盘外 */
export function neighbors8(index: number, w: number, h: number): number[] {
  const x = index % w
  const y = (index / w) | 0
  return DIRS.map(([dx, dy]) => {
    const nx = x + dx
    const ny = y + dy
    return nx < 0 || ny < 0 || nx >= w || ny >= h ? -1 : ny * w + nx
  })
}

export function availMask(index: number, w: number, h: number): number {
  const list = neighbors8(index, w, h)
  let mask = 0
  for (let d = 0; d < 8; d++) if (list[d]! >= 0) mask |= 1 << d
  return mask
}

/** 由 8 位黑格掩码计算循环连续段长度 */
export function blackRuns(mask: number, avail: number): number[] {
  const bits: number[] = []
  for (let d = 0; d < 8; d++) bits.push(avail & (1 << d) ? (mask & (1 << d) ? 1 : 0) : 0)
  if (bits.every((b) => b === 0)) return []
  if (bits.every((b) => b === 1)) return [8]
  let start = 0
  for (let d = 0; d < 8; d++) {
    if (bits[d] === 0) {
      start = (d + 1) % 8
      break
    }
  }
  const runs: number[] = []
  let run = 0
  for (let k = 0; k < 8; k++) {
    const v = bits[(start + k) % 8]!
    if (v === 1) run++
    else if (run > 0) {
      runs.push(run)
      run = 0
    }
  }
  if (run > 0) runs.push(run)
  return runs
}

const allowCache = new Map<string, number[]>()

export function allowedMasks(code: number, index: number, w: number, h: number): number[] {
  const avail = availMask(index, w, h)
  const key = `${code}:${avail}`
  const cached = allowCache.get(key)
  if (cached) return cached
  const runs = patternRuns(code)
  const out: number[] = []
  if (runs) {
    for (let mask = 0; mask < 256; mask++) {
      if ((mask & ~avail) !== 0) continue
      const got = blackRuns(mask, avail)
      if (got.length !== runs.length) continue
      let ok = true
      for (let i = 0; i < runs.length; i++) if (got[i] !== runs[i]) ok = false
      if (ok) out.push(mask)
    }
  }
  allowCache.set(key, out)
  return out
}

export interface TapaPuzzle extends Puzzle {
  clues: number[]
  solution?: number[]
}

export interface TapaState extends GameState {
  cells: number[]
  givens: number[]
}

export interface PatternIssue {
  cell: number
  expected: number[]
  actual: number[]
}

export interface TapaResult extends ValidationResult {
  empty: number
  blockCount: number
  blockCells: number[]
  blackParts: number
  patternIssues: PatternIssue[]
  badCells: number[]
  changedGivens: number[]
  complete: boolean
}

export function asTapaPuzzle(p: Puzzle): TapaPuzzle {
  return p as TapaPuzzle
}

export function asTapaState(s: GameState): TapaState {
  return s as TapaState
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

export function encodeClues(clues: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < clues.length; i++) {
    const v = clues[i]! | 0
    out += v > 0 && v < BASE36.length ? BASE36[v]! : '0'
  }
  return out
}

export function decodeClues(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected).fill(0)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!.toLowerCase()
    if (ch === '.' || ch === '-' || ch === '?') {
      out[i] = 0
      continue
    }
    const v = BASE36.indexOf(ch)
    if (v < 0) return null
    out[i] = v
  }
  return out
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0' || ch === '.') out[i] = EMPTY
    else if (ch === '1' || ch === 'B' || ch === 'b' || ch === '#') out[i] = BLACK
    else if (ch === '2' || ch === 'W' || ch === 'w' || ch === 'o' || ch === 'O') out[i] = WHITE
    else return null
  }
  return out
}

export function givensFromClues(clues: ArrayLike<number>, size: number): number[] {
  const givens = new Array<number>(size).fill(EMPTY)
  for (let i = 0; i < size; i++) if ((clues[i] ?? 0) > 0) givens[i] = WHITE
  return givens
}
