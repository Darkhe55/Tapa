/**
 * 数墙题库生成配置
 *
 * 真正的生成逻辑在 src/game/generator.ts，这里只做模板要求的导出。
 * Node 24 原生支持直接 import .ts（type stripping）。
 */

import { generatePuzzles as generate } from '../src/game/generator.ts'

export const NAME = '土派生成器'

export function generatePuzzles() {
  return generate()
}
