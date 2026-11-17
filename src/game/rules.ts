/**
 * 土派 —— 规则引擎
 *
 * 黑格必须连成一片；任意 2×2 不能全黑；
 * 数字格的 8 邻黑格连续段长度必须与数字模式一致。
 *
 * 规则分类（全部可证明，不猜、不回溯）：
 *   clue    数字模式库：8 邻环上所有合法的黑格段组合（含边角/贴边变体），
 *           取交集强制黑、取并集强制白；数字格必须为白
 *   block   2×2 三黑 → 第四格必须是白；2×2 四黑 → 矛盾
 *   connect 任一黑格连通块必须还有空格邻居，否则无法与其它黑格相连
 *   reach   全局可达性：所有黑格必须落在同一个「非白」连通块里；
 *           不含黑格的非白连通块（整块都是空格）未来只能全白，否则黑格会被白格隔断
 */

import {
  allowedMasks,
  availMask,
  BLACK,
  blackRuns,
  EMPTY,
  neighbors8,
  patternRuns,
  WHITE,
} from './types.ts'

export type RuleKind = 'clue' | 'block' | 'connect' | 'reach'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

export function neighborsOf(index: number, w: number, h: number): number[] {
  const x = index % w
  const y = (index / w) | 0
  const out: number[] = []
  if (x > 0) out.push(index - 1)
  if (x + 1 < w) out.push(index + 1)
  if (y > 0) out.push(index - w)
  if (y + 1 < h) out.push(index + w)
  return out
}

export function componentsOf(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  color: number,
): number[][] {
  const n = w * h
  const seen = new Uint8Array(n)
  const out: number[][] = []
  for (let start = 0; start < n; start++) {
    if (cells[start] !== color || seen[start]) continue
    const comp: number[] = []
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      for (const j of neighborsOf(i, w, h)) {
        if (!seen[j] && cells[j] === color) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    out.push(comp)
  }
  return out
}

export function hasEmptyNeighbor(
  cells: ArrayLike<number>,
  w: number,
  h: number,
  index: number,
): boolean {
  return neighborsOf(index, w, h).some((j) => cells[j] === EMPTY)
}

/** 非白（黑格或空格）的正交连通块，附带块内黑格数量 */
function nonWhiteComponents(
  cells: ArrayLike<number>,
  w: number,
  h: number,
): Array<{ cells: number[]; black: number }> {
  const n = w * h
  const seen = new Uint8Array(n)
  const out: Array<{ cells: number[]; black: number }> = []
  for (let start = 0; start < n; start++) {
    if (cells[start] === WHITE || seen[start]) continue
    const comp: number[] = []
    let black = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      if (cells[i] === BLACK) black++
      for (const j of neighborsOf(i, w, h)) {
        if (!seen[j] && cells[j] !== WHITE) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    out.push({ cells: comp, black })
  }
  return out
}

export function initialGrid(clues: ArrayLike<number>, size: number): number[] {
  const grid = new Array<number>(size).fill(EMPTY)
  for (let i = 0; i < size; i++) if ((clues[i] ?? 0) > 0) grid[i] = WHITE
  return grid
}

export function propagate(
  cells: Int8Array | number[],
  clues: ArrayLike<number>,
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  const n = w * h
  let changed = true

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== EMPTY) return false
    cells[i] = value
    onSet?.(i, value, kind)
    changed = true
    return true
  }

  for (let i = 0; i < n; i++) {
    if ((clues[i] ?? 0) <= 0) continue
    if (cells[i] === BLACK) return false
    if (cells[i] === EMPTY && !set(i, WHITE, 'clue')) return false
  }

  while (changed) {
    changed = false

    for (let i = 0; i < n; i++) {
      const code = clues[i] ?? 0
      if (code <= 0) continue
      const masks = allowedMasks(code, i, w, h)
      if (!masks.length) return false
      const list = neighbors8(i, w, h)
      const consistent: number[] = []
      for (const mask of masks) {
        let ok = true
        for (let d = 0; d < 8; d++) {
          const cell = list[d]!
          if (cell < 0) continue
          if (cells[cell] === BLACK && !(mask & (1 << d))) ok = false
          if (cells[cell] === WHITE && (mask & (1 << d))) ok = false
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
        const cell = list[d]!
        if (cell < 0 || cells[cell] !== EMPTY) continue
        if (inter & (1 << d)) {
          if (!set(cell, BLACK, 'clue')) return false
        } else if (!(union & (1 << d))) {
          if (!set(cell, WHITE, 'clue')) return false
        }
      }
    }

    for (let y = 0; y + 1 < h; y++) {
      const row = y * w
      for (let x = 0; x + 1 < w; x++) {
        const a = row + x
        const b = a + 1
        const c = a + w
        const d = c + 1
        const quad = [a, b, c, d]
        let black = 0
        let unknown = -1
        for (const q of quad) {
          if (cells[q] === BLACK) black++
          else if (cells[q] === EMPTY) unknown = q
        }
        if (black === 4) return false
        if (unknown >= 0 && black === 3 && !set(unknown, WHITE, 'block')) return false
      }
    }

    const comps = componentsOf(cells, w, h, BLACK)
    if (comps.length > 1) {
      for (const comp of comps) {
        let canConnect = false
        for (const i of comp) {
          if (hasEmptyNeighbor(cells, w, h, i)) {
            canConnect = true
            break
          }
        }
        if (!canConnect) return false
      }
    }

    // 全局可达性：黑格必须落在同一个「非白」连通块；不含黑格的非白块只能全白
    let hasBlack = false
    for (let i = 0; i < n; i++) {
      if (cells[i] === BLACK) {
        hasBlack = true
        break
      }
    }
    if (hasBlack) {
      const blocks = nonWhiteComponents(cells, w, h)
      let blackBlocks = 0
      for (const block of blocks) if (block.black > 0) blackBlocks++
      if (blackBlocks > 1) return false
      for (const block of blocks) {
        if (block.black > 0) continue
        // 整块都是空格且碰不到任何黑格：黑格放进来就永远连不回去 → 只能全白
        for (const i of block.cells) {
          if (!set(i, WHITE, 'reach')) return false
        }
      }
    }
  }

  return true
}

export function isValidSolution(
  cells: ArrayLike<number>,
  clues: ArrayLike<number>,
  w: number,
  h: number,
): boolean {
  const n = w * h
  for (let i = 0; i < n; i++) {
    if (cells[i] !== BLACK && cells[i] !== WHITE) return false
  }
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
        return false
      }
    }
  }
  if (componentsOf(cells, w, h, BLACK).length > 1) return false
  for (let i = 0; i < n; i++) {
    const code = clues[i] ?? 0
    if (code <= 0) continue
    if (cells[i] !== WHITE) return false
    const list = neighbors8(i, w, h)
    let mask = 0
    for (let d = 0; d < 8; d++) {
      const cell = list[d]!
      if (cell >= 0 && cells[cell] === BLACK) mask |= 1 << d
    }
    const runs = blackRuns(mask, availMask(i, w, h))
    const want = patternRuns(code)!
    if (runs.length !== want.length) return false
    for (let k = 0; k < runs.length; k++) if (runs[k] !== want[k]) return false
  }
  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

export function solveByRules(
  clues: ArrayLike<number>,
  size: number,
  w: number,
  h: number,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const grid = initialGrid(clues, size)
  let usedProbing = false
  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, clues, w, h)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }
    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, clues, w, h)
      return { ok, solution: ok ? solution : null, contradiction: false, saturated: ok, usedProbing }
    }
    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    usedProbing = true
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
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (blackImpossible !== whiteImpossible) {
        forced.push({ index: i, value: blackImpossible ? WHITE : BLACK })
      }
    }
    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) grid[index] = value
    }
  }
  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}
