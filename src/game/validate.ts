/**
 * 土派 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { componentsOf } from './rules'
import {
  asTapaPuzzle,
  asTapaState,
  availMask,
  BLACK,
  blackRuns,
  EMPTY,
  neighbors8,
  patternRuns,
  WHITE,
  type PatternIssue,
  type TapaResult,
} from './types'

export function validate(state: GameState, puzzle: Puzzle): TapaResult {
  const s = asTapaState(state)
  const p = asTapaPuzzle(puzzle)
  const w = s.width
  const h = s.height
  const size = w * h
  const cells = s.cells
  const clues = p.clues ?? []

  let empty = 0
  const changed = new Set<number>()
  for (let i = 0; i < size; i++) {
    if (cells[i] === EMPTY) empty++
    if ((clues[i] ?? 0) > 0 && cells[i] !== WHITE) changed.add(i)
  }

  let blockCount = 0
  const blockSet = new Set<number>()
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const a = y * w + x
      const b = a + 1
      const c = a + w
      const d = c + 1
      if (
        cells[a] === BLACK &&
        cells[b] === BLACK &&
        cells[c] === BLACK &&
        cells[d] === BLACK
      ) {
        blockCount++
        blockSet.add(a)
        blockSet.add(b)
        blockSet.add(c)
        blockSet.add(d)
      }
    }
  }

  const blackParts = componentsOf(cells, w, h, BLACK).length
  const complete = empty === 0
  const bad = new Set<number>(blockSet)
  for (const i of changed) bad.add(i)

  const patternIssues: PatternIssue[] = []
  for (let i = 0; i < size; i++) {
    const code = clues[i] ?? 0
    if (code <= 0) continue
    if (cells[i] !== WHITE) continue
    const list = neighbors8(i, w, h)
    let mask = 0
    for (let d = 0; d < 8; d++) {
      const cell = list[d]!
      if (cell >= 0 && cells[cell] === BLACK) mask |= 1 << d
    }
    const actual = blackRuns(mask, availMask(i, w, h))
    const expected = patternRuns(code)!
    let same = actual.length === expected.length
    if (same) for (let k = 0; k < expected.length; k++) if (actual[k] !== expected[k]) same = false
    if (!same) {
      patternIssues.push({ cell: i, expected, actual })
      bad.add(i)
    }
  }

  const solved =
    complete && blockCount === 0 && blackParts <= 1 && changed.size === 0 && patternIssues.length === 0

  return {
    solved,
    empty,
    complete,
    blockCount,
    blockCells: Array.from(blockSet),
    blackParts,
    patternIssues,
    badCells: Array.from(bad),
    changedGivens: Array.from(changed),
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as TapaResult
  if (r.solved) return ['完成']
  const bits: string[] = []
  if (typeof r.empty === 'number' && r.empty > 0) bits.push(`还需填 ${r.empty} 格`)
  if (r.blockCount > 0) bits.push(`${r.blockCount} 处 2×2 全黑`)
  if (r.patternIssues.length > 0) bits.push(`${r.patternIssues.length} 个数字的黑段不匹配`)
  if (r.blackParts > 1) bits.push(`黑格分成 ${r.blackParts} 块未连通`)
  if (r.changedGivens.length > 0) bits.push('数字格被改动')
  if (bits.length === 0) bits.push('继续推理')
  return bits
}
