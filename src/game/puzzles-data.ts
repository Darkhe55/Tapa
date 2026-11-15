/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */
  board: string
  /** 参考解编码串（没有则留空） */
  solution?: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "tapa-8x8-lgds75", name: "初识土派", width: 8, height: 8, difficulty: 'easy', series: "入门", board: "0000000000000000020000000000000050003002000000000900000f0000f000", solution: "2222222222222222222222221122222221222222111111112221212222112111" },
  { id: "tapa-8x8-lgds76", name: "黑段初现", width: 8, height: 8, difficulty: 'easy', series: "入门", board: "00000000000000000300000000000000000a000000d009023000000000000000", solution: "2222222222222222122222221122222221121222112112222112121122111112" },
  { id: "tapa-8x8-lgds77", name: "连续黑带", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "0210005000000000000000050200900000000f00000000000000200000000010", solution: "2222212111221111211112122221211122222221222221112222212222222222" },
  { id: "tapa-8x8-lgds78", name: "土派迷宫", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "0100000000000200000500000000000504000d00000000050105000000020500", solution: "2222222222122212221222112111111222122211221112122222111122221212" },
  { id: "tapa-8x8-lgds79", name: "土派之壁", width: 8, height: 8, difficulty: 'hard', series: "挑战", board: "00000000004020003000002000000000300i0004000000000000040230503000", solution: "2222222222212222211122221121111221121212221211111111122221212222" },
  { id: "tapa-8x8-lgds7a", name: "终局土派", width: 8, height: 8, difficulty: 'hard', series: "挑战", board: "0204000000000000010400400000000006600i00000000000000000504050500", solution: "2212222222111222222211222222211122211212121212111111111222121211" },
]
