/**
 * ════════════════════════════════════════════════════════════════════
 *  土派（Tapa）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 状态：0 = 未定，1 = 黑，2 = 白。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  decodeClues,
  encodeClues,
  patternRuns,
  PATTERNS,
  type TapaPuzzle,
} from './types'

const meta = {
  title: '土派',
  tagline: '数字表示周围八格中连续黑格的段长',
  footerNote:
    '规则：涂黑部分格子。所有黑格必须上下左右连成一片；任意 2×2 区域不能全黑；数字格为白，其周围八格按顺时针看，黑格连续段的长度必须与数字完全一致（如「1 3」表示一段 1 格、一段 3 格）。',
  storageKeyPrefix: 'tapa',
  customIdPrefix: 'tapa-custom-',
  customMinW: 5,
  customMinH: 5,
  customMaxW: 40,
  customMaxH: 40,
  targetKind: 'cell' as const,
}

const custom: CustomSupport = {
  valueCycle: [null, ...PATTERNS.map((_, i) => i + 1)],
  keyForDigit: (digit) =>
    digit === 0 ? null : digit >= 1 && digit <= 9 ? digit : undefined,
  cellLabel: (v) => (v == null ? '' : (patternRuns(v)?.join(' ') ?? '')),
  hint: '数字格填「连续黑段」提示：点击循环 1、2、3…（对应段长 1、2、3…），键盘 1-9 直接填。',
  toGrid: (p) => {
    const clues = (p as TapaPuzzle).clues
    if (!Array.isArray(clues) || clues.length !== p.width * p.height) return null
    return {
      width: p.width,
      height: p.height,
      grid: clues.map((v) => (typeof v === 'number' && v >= 1 ? v : null)),
    }
  },
  makePuzzle: (w, h, grid, existingId) => ({
    id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
    name: `自定义 · ${w}×${h}`,
    width: w,
    height: h,
    difficulty: 'custom',
    clues: grid.map((v) => (typeof v === 'number' && v >= 1 && v <= PATTERNS.length ? v : 0)),
  } satisfies TapaPuzzle),
  encodePuzzle: (p) => {
    const tp = p as TapaPuzzle
    return { clues: encodeClues(tp.clues ?? []) }
  },
  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
    const clues =
      typeof record.clues === 'string' ? decodeClues(record.clues, w * h) : null
    if (!clues) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      clues,
    } satisfies TapaPuzzle
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.to === 1) playDrop(streak)
  else if (move.to === 2) playPluck(streak, 0.9)
  else playPluck(streak, 1.2)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
