/**
 * 土派 —— 回溯求解器
 *
 * 规则传播（岛屿大小 / 2×2 / 黑格连通 / 可达性）+ 回溯搜索。
 * 用于唯一解计数、显示解、提示一格的参考解以及自定义题板的「求解」。
 */

import type { Puzzle, SolveResult } from '../core/types'
import {
  initialGrid,
  isValidSolution,
  propagate,
  solveByRules,
} from './rules.ts'
import { BLACK, EMPTY, type TapaState, WHITE } from './types.ts'

export interface SearchOutcome {
  solutions: number[][]
  nodes: number
  timedOut: boolean
}

export interface CountOutcome {
  count: number
  nodes: number
  timedOut: boolean
}

function search(
  clues: ArrayLike<number>,
  size: number,
  w: number,
  h: number,
  limit: number,
  maxNodes: number,
): SearchOutcome {
  const grid = initialGrid(clues, size)
  const solutions: number[][] = []
  let nodes = 0
  let timedOut = false

  const dfs = (): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return
    }
    if (!propagate(grid, clues, w, h)) return

    let choice = -1
    let best = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let score = 0
      const x = i % w
      const y = (i / w) | 0
      if (x > 0 && grid[i - 1] !== EMPTY) score++
      if (x + 1 < w && grid[i + 1] !== EMPTY) score++
      if (y > 0 && grid[i - w] !== EMPTY) score++
      if (y + 1 < h && grid[i + w] !== EMPTY) score++
      if (score > best) {
        best = score
        choice = i
      }
    }

    if (choice < 0) {
      if (isValidSolution(grid, clues, w, h)) solutions.push(Array.from(grid))
      return
    }

    const backup = Array.from(grid)
    for (const value of [BLACK, WHITE] as const) {
      if (solutions.length >= limit || timedOut) return
      grid[choice] = value
      dfs()
      for (let i = 0; i < size; i++) grid[i] = backup[i]!
    }
  }

  dfs()
  return { solutions, nodes, timedOut }
}

export function countSolutions(
  clues: ArrayLike<number>,
  size: number,
  w: number,
  h: number,
  limit = 2,
  maxNodes = 400_000,
): CountOutcome {
  const out = search(clues, size, w, h, limit, maxNodes)
  return { count: out.solutions.length, nodes: out.nodes, timedOut: out.timedOut }
}

export function findSolution(
  clues: ArrayLike<number>,
  size: number,
  w: number,
  h: number,
  maxNodes = 1_500_000,
): { solution: number[] | null; nodes: number; timedOut: boolean } {
  const out = search(clues, size, w, h, 1, maxNodes)
  return { solution: out.solutions[0] ?? null, nodes: out.nodes, timedOut: out.timedOut }
}

export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const clues = (puzzle as { clues?: number[] }).clues ?? []
  const size = puzzle.width * puzzle.height
  if (clues.length !== size) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }

  // 先试试纯规则 + 反证；能推满就不必搜索
  const byRules = solveByRules(clues, size, puzzle.width, puzzle.height, true, 240)
  if (byRules.ok && byRules.solution) {
    return {
      solved: true,
      solution: makeState(puzzle.id, puzzle.width, puzzle.height, byRules.solution, clues),
      nodes: 0,
      timedOut: false,
    }
  }
  if (byRules.contradiction) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }

  const result = findSolution(clues, size, puzzle.width, puzzle.height, maxNodes)
  if (!result.solution) {
    return {
      solved: false,
      solution: null,
      nodes: result.nodes,
      timedOut: result.timedOut,
    }
  }
  return {
    solved: true,
    solution: makeState(puzzle.id, puzzle.width, puzzle.height, result.solution, clues),
    nodes: result.nodes,
    timedOut: false,
  }
}

export function makeState(
  puzzleId: string,
  width: number,
  height: number,
  cells: number[],
  clues: ArrayLike<number>,
): TapaState {
  const givens = new Array<number>(width * height).fill(EMPTY)
  for (let i = 0; i < givens.length; i++) {
    if ((clues[i] ?? 0) > 0) givens[i] = WHITE
  }
  return { puzzleId, width, height, cells: cells.slice(), givens }
}
