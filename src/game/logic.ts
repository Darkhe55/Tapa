/**
 * 土派 —— 逻辑解题回放计划
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { findSolution } from './solver'
import { propagate, type RuleKind } from './rules'
import { asTapaPuzzle, asTapaState, BLACK, EMPTY, WHITE, type TapaState } from './types'

const RULE_INFO: Record<RuleKind | 'probe' | 'search', { rule: number; label: string }> = {
  clue: { rule: 1, label: '数字周围黑段模式（含边角变体）与数字格为白' },
  block: { rule: 2, label: '2×2 三黑 → 第四格必须是白格' },
  connect: { rule: 3, label: '黑格必须连成一片（连通块仍需空位）' },
  reach: { rule: 4, label: '黑格全局可达：白格不能把黑格隔断' },
  probe: { rule: 5, label: '反证：另一种颜色会立刻矛盾' },
  search: { rule: 6, label: '回溯试探：该格最终是这一色' },
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asTapaPuzzle(puzzle)
  const s = asTapaState(initialState)
  const w = s.width
  const h = s.height
  const size = w * h
  const clues = p.clues ?? []

  const emptyPlan: LogicPlan = {
    puzzleId: p.id,
    frames: [],
    finalState: null,
    ruleSteps: 0,
    saturated: false,
  }
  if (clues.length !== size) return emptyPlan

  const grid = s.cells.slice()
  const displayed = s.cells.slice()
  const frames: PlaybackFrame[] = []
  let lastKind = ''
  let streak = 0
  let contradiction = false

  const emit = (index: number, to: number, kind: RuleKind | 'probe' | 'search'): void => {
    const from = displayed[index] ?? EMPTY
    if (from === to) return
    displayed[index] = to
    if (kind === lastKind) streak++
    else {
      lastKind = kind
      streak = 1
    }
    const info = RULE_INFO[kind]
    frames.push({ rule: info.rule, label: info.label, move: { index, from, to }, streak })
  }

  const onSet = (index: number, value: number, kind: RuleKind): void => {
    emit(index, value, kind)
  }

  const finish = (saturated: boolean): LogicPlan => {
    if (contradiction) return emptyPlan
    const finalState: TapaState = {
      puzzleId: s.puzzleId,
      width: w,
      height: h,
      cells: Array.from(grid),
      givens: s.givens.slice(),
    }
    return { puzzleId: p.id, frames, finalState, ruleSteps: frames.length, saturated }
  }

  if (!propagate(grid, clues, w, h, onSet)) return emptyPlan

  let saturated = true
  for (let round = 0; round < size * 2; round++) {
    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) break
    if (frames.length > 6000) {
      saturated = false
      break
    }

    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let blackImpossible = false
      let whiteImpossible = false
      {
        const trial = Int8Array.from(grid)
        trial[i] = BLACK
        if (!propagate(trial, clues, w, h)) blackImpossible = true
      }
      {
        const trial = Int8Array.from(grid)
        trial[i] = WHITE
        if (!propagate(trial, clues, w, h)) whiteImpossible = true
      }
      if (blackImpossible && whiteImpossible) {
        contradiction = true
        return finish(false)
      }
      if (blackImpossible !== whiteImpossible) {
        forced.push({ index: i, value: blackImpossible ? WHITE : BLACK })
      }
    }

    if (!forced.length) {
      saturated = false
      break
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) {
        grid[index] = value
        emit(index, value, 'probe')
      }
    }
    if (!propagate(grid, clues, w, h, onSet)) return emptyPlan
  }

  let stillUnknown = false
  for (let i = 0; i < size; i++) {
    if (grid[i] === EMPTY) {
      stillUnknown = true
      break
    }
  }

  if (stillUnknown) {
    const found = findSolution(clues, size, w, h, 600_000)
    if (!found.solution) return emptyPlan
    for (let i = 0; i < size; i++) {
      if (grid[i] === found.solution[i]) continue
      grid[i] = found.solution[i]!
      emit(i, found.solution[i]!, 'search')
    }
    saturated = false
  }

  return finish(saturated)
}
