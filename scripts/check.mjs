/**
 * 数墙题库审计
 *
 * - 数据结构：id 唯一 / 宽高 / 线索串与解串长度
 * - 规则：线索格为白、参考解合法、恰好一解
 * - 逻辑：传播 + 反证能否推满（推不满只警告）
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { decodeCells, decodeClues } from '../src/game/types.ts'
import { isValidSolution, solveByRules } from '../src/game/rules.ts'
import { countSolutions } from '../src/game/solver.ts'

const DATA_FILE = path.resolve('src/game/puzzles-data.ts')
const text = readFileSync(DATA_FILE, 'utf8')

const entries = []
const re =
  /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*width:\s*(\d+),\s*height:\s*(\d+),\s*difficulty:\s*'([^']+)',\s*series:\s*"([^"]+)",\s*board:\s*"([^"]*)",\s*solution:\s*"([^"]*)"\s*\}/g
let m
while ((m = re.exec(text)) !== null) {
  entries.push({
    id: m[1],
    name: m[2],
    width: Number(m[3]),
    height: Number(m[4]),
    difficulty: m[5],
    series: m[6],
    board: m[7],
    solution: m[8],
  })
}

let errors = 0
let warnings = 0
const ids = new Set()

for (const e of entries) {
  const size = e.width * e.height
  if (ids.has(e.id)) {
    console.error(`[check] 重复 id: ${e.id}`)
    errors++
  }
  ids.add(e.id)
  if (!e.name) {
    console.error(`[check] ${e.id} 缺 name`)
    errors++
  }
  if (e.width <= 0 || e.height <= 0) {
    console.error(`[check] ${e.id} 宽高非法: ${e.width}×${e.height}`)
    errors++
    continue
  }
  if (e.board.length !== size) {
    console.error(`[check] ${e.id} 线索串长度 ${e.board.length} != ${size}`)
    errors++
    continue
  }
  if (e.solution.length !== size) {
    console.error(`[check] ${e.id} 解串长度 ${e.solution.length} != ${size}`)
    errors++
    continue
  }

  const clues = decodeClues(e.board, size)
  const solution = decodeCells(e.solution, size)
  if (!clues || !solution) {
    console.error(`[check] ${e.id} 线索/解编码非法`)
    errors++
    continue
  }

  let clueCells = 0
  for (let i = 0; i < size; i++) {
    if (clues[i] > 0) {
      clueCells++
      if (solution[i] !== 2) {
        console.error(`[check] ${e.id} 数字格 ${i} 在参考解中不是白格`)
        errors++
        break
      }
    }
  }
  if (clueCells === 0) {
    console.error(`[check] ${e.id} 没有任何数字线索`)
    errors++
    continue
  }

  if (!isValidSolution(solution, clues, e.width, e.height)) {
    console.error(`[check] ${e.id} 参考解不合法`)
    errors++
    continue
  }

  const counted = countSolutions(clues, size, e.width, e.height, 2, 800_000)
  if (counted.timedOut) {
    console.warn(`[check] ${e.id} 唯一解检查超时（${counted.nodes} 节点）`)
    warnings++
  } else if (counted.count !== 1) {
    console.error(`[check] ${e.id} 解不唯一：找到 ${counted.count} 个`)
    errors++
    continue
  }

  const plan = solveByRules(clues, size, e.width, e.height, true, 240)
  if (!plan.ok || !plan.solution) {
    console.warn(`[check] ${e.id} 规则无法单独推满（需要回溯）`)
    warnings++
  } else if (!plan.saturated) {
    console.warn(`[check] ${e.id} 需要回溯（逻辑推演未饱和）`)
    warnings++
  }

  console.log(
    `[check] ${e.id} ${e.width}×${e.height} 数字 ${clueCells} · 解唯一 · 逻辑${plan.saturated ? '可推满' : '需回溯'} · ${counted.nodes} 节点`,
  )
}

console.log(`[check] 共 ${entries.length} 题，错误 ${errors}，警告 ${warnings}`)
if (entries.length === 0) {
  console.warn('[check] 题库为空，请先运行 npm run gen。')
}
if (errors > 0) process.exitCode = 1
