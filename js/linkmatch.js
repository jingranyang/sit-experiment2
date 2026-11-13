// "连连看" (Lianliankan / tile-pair-matching) mini-game engine. Two identical
// tiles can be cleared if a connecting path between them exists using at
// most two right-angle turns, routed through empty cells (or the single-cell
// border ring around the grid). Pure logic module, no rendering — game.js
// owns the DOM/canvas presentation, this module just tracks the board and
// answers "can these two tiles connect" / "is any move still possible".
window.LinkMatch = (function () {
  'use strict';

  // Distinct glyphs used as tile faces. Only the first `symbolTypes` of a
  // difficulty's config are used, so easy boards use fewer distinct symbols
  // (easier to spot pairs) than hard boards.
  const SYMBOLS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⭐', '❤️', '⬛', '⬜', '🔶', '🔷', '🔺', '🔻', '🟤', '💠'];

  const DIFFICULTY = {
    easy: { cols: 4, rows: 4, symbolTypes: 6 },     // 16 cells / 8 pairs
    medium: { cols: 6, rows: 6, symbolTypes: 10 },  // 36 cells / 18 pairs
    hard: { cols: 8, rows: 6, symbolTypes: 14 },    // 48 cells / 24 pairs
  };

  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Builds a solvable board: `cols*rows` must be even. Every symbol occurs
  // an even number of times by construction (built entirely out of pairs),
  // so the board is always fully clearable in principle; reshuffleUntilSolvable
  // still guards against a shuffled arrangement that happens to have zero
  // *currently* reachable pairs.
  function generateBoard(difficultyKey) {
    const cfg = DIFFICULTY[difficultyKey] || DIFFICULTY.medium;
    const { cols, rows, symbolTypes } = cfg;
    const total = cols * rows;
    const numPairs = Math.floor(total / 2);
    const list = [];
    for (let i = 0; i < numPairs; i++) {
      const symbol = randInt(0, symbolTypes - 1);
      list.push(symbol, symbol);
    }
    while (list.length < total) list.push(randInt(0, symbolTypes - 1)); // odd cell count fallback
    shuffle(list);
    const board = { cols, rows, cells: list, symbolTypes };
    reshuffleUntilSolvable(board);
    return board;
  }

  // BFS over (row, col, direction, turnsUsed) with turnsUsed capped at 2.
  // The grid is padded with a one-cell border ring (row/col == -1 or ==
  // rows/cols) which is always passable, matching the classic Lianliankan
  // rule that a path may route around the outside edge of the board.
  function canConnect(board, r1, c1, r2, c2) {
    return findPath(board, r1, c1, r2, c2) !== null;
  }

  // Same search as canConnect, but returns the connecting path as a list of
  // corner points [{r, c}, ...] (start, each turn, end), or null if the two
  // tiles can't be connected. Points may lie on the border ring (row/col -1
  // or rows/cols). Used to draw the connecting line when a pair is cleared.
  function findPath(board, r1, c1, r2, c2) {
    const { cols, rows, cells } = board;
    const passable = (r, c) => {
      if (r < -1 || r > rows || c < -1 || c > cols) return false;
      if ((r === r1 && c === c1) || (r === r2 && c === c2)) return true;
      if (r < 0 || r >= rows || c < 0 || c >= cols) return true; // border ring
      return cells[r * cols + c] === null;
    };
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const visited = new Set(['s']);
    const queue = [{ r: r1, c: c1, dir: -1, turns: 0, parent: null }];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      if (cur.r === r2 && cur.c === c2) return cornerPoints(cur);
      for (let d = 0; d < 4; d++) {
        const nr = cur.r + DIRS[d][0], nc = cur.c + DIRS[d][1];
        if (!passable(nr, nc)) continue;
        const turns = cur.dir !== -1 && cur.dir !== d ? cur.turns + 1 : cur.turns;
        if (turns > 2) continue;
        const key = nr + ',' + nc + ',' + d + ',' + turns;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ r: nr, c: nc, dir: d, turns, parent: cur });
      }
    }
    return null;
  }

  // Walks the BFS parent chain back to the start and keeps only the points
  // where the direction changes, giving at most four points (two turns).
  function cornerPoints(node) {
    const cellsOnPath = [];
    for (let n = node; n; n = n.parent) cellsOnPath.push({ r: n.r, c: n.c, dir: n.dir });
    cellsOnPath.reverse();
    const points = [{ r: cellsOnPath[0].r, c: cellsOnPath[0].c }];
    for (let i = 1; i < cellsOnPath.length - 1; i++) {
      if (cellsOnPath[i + 1].dir !== cellsOnPath[i].dir) points.push({ r: cellsOnPath[i].r, c: cellsOnPath[i].c });
    }
    const last = cellsOnPath[cellsOnPath.length - 1];
    points.push({ r: last.r, c: last.c });
    return points;
  }

  function idxToRC(idx, cols) { return { r: Math.floor(idx / cols), c: idx % cols }; }

  // Returns [idxA, idxB] of a currently-connectable pair, or null if none
  // exists. Used both to detect deadlocks and (via the debug hook) so the
  // automated test suite can click a real, exact pair instead of guessing.
  function findValidPair(board) {
    const { cols, rows, cells } = board;
    const bySymbol = {};
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === null) continue;
      (bySymbol[cells[i]] = bySymbol[cells[i]] || []).push(i);
    }
    for (const symbol in bySymbol) {
      const idxs = bySymbol[symbol];
      for (let i = 0; i < idxs.length; i++) {
        for (let j = i + 1; j < idxs.length; j++) {
          const a = idxToRC(idxs[i], cols), b = idxToRC(idxs[j], cols);
          if (canConnect(board, a.r, a.c, b.r, b.c)) return [idxs[i], idxs[j]];
        }
      }
    }
    return null;
  }

  function hasAnyValidMove(board) { return findValidPair(board) !== null; }

  // Reshuffles the remaining (non-cleared) tiles in place until at least one
  // valid move exists, so the board can never hard-deadlock mid-round. Caps
  // attempts as a safety net; in practice this resolves in 1-2 tries.
  function reshuffleUntilSolvable(board, maxTries) {
    maxTries = maxTries || 200;
    const remaining = board.cells.some((v) => v !== null);
    if (!remaining) return board; // fully cleared, nothing to do
    for (let attempt = 0; attempt < maxTries; attempt++) {
      if (hasAnyValidMove(board)) return board;
      const idxs = [], vals = [];
      for (let i = 0; i < board.cells.length; i++) {
        if (board.cells[i] !== null) { idxs.push(i); vals.push(board.cells[i]); }
      }
      shuffle(vals);
      idxs.forEach((idx, k) => { board.cells[idx] = vals[k]; });
    }
    return board; // best effort — astronomically unlikely to fall through
  }

  return { SYMBOLS, DIFFICULTY, generateBoard, canConnect, findPath, findValidPair, hasAnyValidMove, reshuffleUntilSolvable };
})();
