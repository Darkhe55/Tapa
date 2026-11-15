/**
 * 土派 —— 题库加载
 *
 * board = 线索模式编号（每格一个 base36 字符，0 表示无数字）
 * solution = 参考解（1 = 黑，2 = 白）
 */

import { RAW_PUZZLES } from './puzzles-data'
import {
  asTapaPuzzle,
  decodeCells,
  decodeClues,
  givensFromClues,
  WHITE,
  type TapaPuzzle,
  type TapaState,
} from './types'

export const builtinPuzzles: TapaPuzzle[] = []
const solutions = new Map<string, number[]>()

for (const raw of RAW_PUZZLES) {
  const size = raw.width * raw.height
  const clues = decodeClues(raw.board, size)
  if (!clues) {
    console.warn(`[土派] 线索解码失败：${raw.id}`)
    continue
  }
  let clueTotal = 0
  for (const c of clues) if (c > 0) clueTotal++
  if (clueTotal === 0) {
    console.warn(`[土派] 题目没有任何数字：${raw.id}`)
    continue
  }

  const puzzle: TapaPuzzle = {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    clues,
  }
  builtinPuzzles.push(puzzle)

  if (raw.solution) {
    const solution = decodeCells(raw.solution, size)
    if (solution) {
      let valid = true
      for (let i = 0; i < size; i++) {
        if (solution[i] !== 1 && solution[i] !== 2) {
          valid = false
          break
        }
        if (clues[i]! > 0 && solution[i] !== WHITE) valid = false
      }
      if (valid) {
        puzzle.solution = solution
        solutions.set(raw.id, solution)
      } else {
        console.warn(`[土派] 参考解与线索不一致：${raw.id}`)
      }
    }
  }
}

export function getReferenceSolution(id: string): TapaState | null {
  const cells = solutions.get(id)
  if (!cells) return null
  const puzzle = builtinPuzzles.find((p) => p.id === id)
  if (!puzzle) return null
  const size = puzzle.width * puzzle.height
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: givensFromClues(puzzle.clues, size),
  }
}

export function puzzleById(id: string): TapaPuzzle | undefined {
  return builtinPuzzles.find((p) => p.id === id)
}

export function referenceFor(puzzle: TapaPuzzle): number[] | null {
  return asTapaPuzzle(puzzle).solution ?? solutions.get(puzzle.id) ?? null
}
