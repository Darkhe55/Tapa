/**
 * 土派 —— 棋盘状态
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import {
  asTapaPuzzle,
  asTapaState,
  BLACK,
  decodeCells,
  EMPTY,
  encodeCells,
  givensFromClues,
  WHITE,
  type TapaState,
} from './types'

export function createEmptyState(puzzle: Puzzle): TapaState {
  const p = asTapaPuzzle(puzzle)
  const size = p.width * p.height
  const givens = givensFromClues(p.clues ?? [], size)
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    cells: givens.slice(),
    givens,
  }
}

export function cloneState(state: GameState): TapaState {
  const s = asTapaState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: s.cells.slice(),
    givens: s.givens.slice(),
  }
}

export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asTapaState(state)
  const given = s.givens[target.index] ?? EMPTY
  if (given !== EMPTY) return given
  const v = s.cells[target.index] ?? EMPTY
  // 左键：空/负面(白) → 正面(黑)；正面 → 空
  if (v === EMPTY || v === WHITE) return BLACK
  return EMPTY
}

export function rightClickValue(state: GameState, target: HitTarget): number {
  const s = asTapaState(state)
  const given = s.givens[target.index] ?? EMPTY
  if (given !== EMPTY) return given
  return s.cells[target.index] === WHITE ? EMPTY : WHITE
}

export function applyMove(state: GameState, move: Move): void {
  const s = asTapaState(state)
  if (move.index < 0 || move.index >= s.cells.length) return
  if ((s.givens[move.index] ?? EMPTY) !== EMPTY) return
  s.cells[move.index] = move.to === BLACK || move.to === WHITE ? move.to : EMPTY
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return asTapaState(state).cells[index] ?? EMPTY
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asTapaState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: encodeCells(s.cells),
    givens: encodeCells(s.givens),
  }
}

function readCells(value: unknown, size: number): number[] | null {
  if (typeof value === 'string') return decodeCells(value, size)
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (n !== EMPTY && n !== BLACK && n !== WHITE) return null
      out.push(n)
    }
    return out
  }
  return null
}

export function deserializeState(data: Record<string, unknown>): TapaState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const w = data.width
  const h = data.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
  const size = w * h
  const cells = readCells(data.cells, size)
  if (!cells) return null
  const givens = readCells(data.givens, size) ?? new Array<number>(size).fill(EMPTY)
  for (let i = 0; i < size; i++) if (givens[i] !== EMPTY) cells[i] = givens[i]!
  return { puzzleId: data.puzzleId, width: w, height: h, cells, givens }
}

export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asTapaState(state)
  const sol = asTapaState(solution)
  const size = Math.min(s.cells.length, sol.cells.length)
  for (let i = 0; i < size; i++) {
    if (s.givens[i] !== EMPTY) continue
    if (s.cells[i] === EMPTY && sol.cells[i] !== EMPTY) {
      return { index: i, from: EMPTY, to: sol.cells[i]! }
    }
  }
  for (let i = 0; i < size; i++) {
    if (s.givens[i] !== EMPTY) continue
    if (s.cells[i] !== sol.cells[i]) {
      return { index: i, from: s.cells[i]!, to: sol.cells[i]! }
    }
  }
  return null
}
