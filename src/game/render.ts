/**
 * 土派 —— SVG 渲染与命中
 *
 * 视觉层次：
 *   棋盘底色 → 水（黑格）/ 陆地（白格）/ 空格 → 数字线索 → 错误高亮 → 命中层
 */

import type { BoardMetrics, GameState, Puzzle, ValidationResult } from '../core/types'
import {
  asTapaPuzzle,
  asTapaState,
  BLACK,
  EMPTY,
  patternRuns,
  WHITE,
  type TapaResult,
} from './types'

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const cell = 50
  const pad = Math.round(cell * 0.42)
  return {
    cell,
    pad,
    width: puzzle.width,
    height: puzzle.height,
    svgWidth: pad * 2 + puzzle.width * cell,
    svgHeight: pad * 2 + puzzle.height * cell,
    k: 1,
  }
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const m = metricsFor(puzzle)
  const p = asTapaPuzzle(puzzle)
  const s = asTapaState(state)
  const r = result as TapaResult
  const w = puzzle.width
  const h = puzzle.height
  const clues = p.clues ?? []

  const bad = new Set<number>(r.badCells ?? [])
  const block = new Set<number>(r.blockCells ?? [])
  const changed = new Set<number>(r.changedGivens ?? [])

  const gap = Math.max(1, m.cell * 0.035)
  const inner = m.cell - gap
  const radius = m.cell * 0.14

  const parts: string[] = []
  parts.push(
    `<rect class="sk-board-bg" x="${m.pad - 9}" y="${m.pad - 9}" width="${w * m.cell + 18}" height="${h * m.cell + 18}" rx="${(m.cell * 0.22).toFixed(2)}" />`,
  )

  for (let i = 0; i < w * h; i++) {
    const x = m.pad + (i % w) * m.cell + gap / 2
    const y = m.pad + Math.floor(i / w) * m.cell + gap / 2
    const v = s.cells[i] ?? EMPTY
    const clue = clues[i] ?? 0
    const given = (s.givens[i] ?? EMPTY) !== EMPTY

    let cls = 'sk-cell'
    if (v === BLACK) cls += ' black'
    else if (v === WHITE) cls += ' white'
    else cls += ' empty'
    if (given) cls += ' given'
    if (clue > 0) cls += ' clue'
    if (bad.has(i)) cls += ' bad'
    if (block.has(i)) cls += ' block'
    if (changed.has(i)) cls += ' changed'

    let content = `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${radius.toFixed(2)}" />`

    if (clue > 0) {
      const runs = patternRuns(clue) ?? []
      const label = runs.join(' ')
      const fontSize = (label.length >= 2 ? m.cell * 0.27 : m.cell * 0.38).toFixed(2)
      content += `<text class="sk-clue${v === BLACK ? ' on-black' : ''}" x="${(x + inner / 2).toFixed(2)}" y="${(y + inner / 2 + m.cell * 0.02).toFixed(2)}" style="font-size:${fontSize}px">${label}</text>`
    } else if (v === BLACK) {
      content += `<path class="sk-wave" d="M ${(x + inner * 0.24).toFixed(2)} ${(y + inner * 0.52).toFixed(2)} q ${(inner * 0.13).toFixed(2)} ${(-inner * 0.11).toFixed(2)} ${(inner * 0.26).toFixed(2)} 0 t ${(inner * 0.26).toFixed(2)} 0" />`
    }

    if (block.has(i)) {
      content += `<rect class="sk-block" x="${(x + 1.2).toFixed(2)}" y="${(y + 1.2).toFixed(2)}" width="${(inner - 2.4).toFixed(2)}" height="${(inner - 2.4).toFixed(2)}" rx="${(radius * 0.8).toFixed(2)}" />`
    } else if (bad.has(i)) {
      content += `<rect class="sk-error" x="${(x + 1.2).toFixed(2)}" y="${(y + 1.2).toFixed(2)}" width="${(inner - 2.4).toFixed(2)}" height="${(inner - 2.4).toFixed(2)}" rx="${(radius * 0.8).toFixed(2)}" />`
    }

    parts.push(`<g data-index="${i}">${content}</g>`)
    parts.push(
      `<rect class="cell-hit" data-index="${i}" x="${(m.pad + (i % w) * m.cell).toFixed(2)}" y="${(m.pad + Math.floor(i / w) * m.cell).toFixed(2)}" width="${m.cell.toFixed(2)}" height="${m.cell.toFixed(2)}" />`,
    )
  }

  return `<svg class="board-svg sk-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(
  m: BoardMetrics,
  puzzle: Puzzle,
  x: number,
  y: number,
): { index: number } | null {
  const col = Math.floor((x - m.pad) / m.cell)
  const row = Math.floor((y - m.pad) / m.cell)
  if (col < 0 || row < 0 || col >= puzzle.width || row >= puzzle.height) return null
  return { index: row * puzzle.width + col }
}
