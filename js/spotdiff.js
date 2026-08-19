// Procedurally generated "spot the difference" mini-game — two panels of
// simple shapes (circles/squares/triangles) that are identical except for a
// handful of differences (recolored / resized / moved / missing shape).
// Pure canvas + JS, no external image assets, so it works offline on GitHub
// Pages and a fresh round can be generated instantly client-side.
window.SpotDiff = (function () {
  'use strict';

  const PALETTE = ['#4f8cff', '#ff7a59', '#35c48f', '#ffd166', '#c77dff', '#f25f5c', '#70e4ef', '#ffb4a2'];
  const SHAPE_TYPES = ['circle', 'square', 'triangle'];

  const DIFFICULTY = {
    easy: { shapeCount: 5, diffCount: 3, sizeMin: 22, sizeMax: 32, moveRange: 30, tolerance: 16 },
    medium: { shapeCount: 8, diffCount: 4, sizeMin: 16, sizeMax: 26, moveRange: 26, tolerance: 12 },
    hard: { shapeCount: 12, diffCount: 5, sizeMin: 12, sizeMax: 20, moveRange: 22, tolerance: 8 },
  };

  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
  function pickDistinctIndices(count, poolSize) {
    const pool = Array.from({ length: poolSize }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) { const j = randInt(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, count);
  }

  function generateRound(canvasW, canvasH, difficultyKey) {
    const cfg = DIFFICULTY[difficultyKey] || DIFFICULTY.medium;
    const cols = Math.max(1, Math.round(Math.sqrt(cfg.shapeCount * (canvasW / canvasH))));
    const rows = Math.ceil(cfg.shapeCount / cols);
    const cellW = canvasW / cols, cellH = canvasH / rows;

    const shapesA = [];
    for (let i = 0; i < cfg.shapeCount; i++) {
      const cellX = i % cols, cellY = Math.floor(i / cols);
      const jitterMax = Math.min(cellW, cellH) * 0.15;
      const x = cellX * cellW + cellW / 2 + randInt(-jitterMax, jitterMax);
      const y = cellY * cellH + cellH / 2 + randInt(-jitterMax, jitterMax);
      shapesA.push({
        type: pick(SHAPE_TYPES),
        x, y,
        size: randInt(cfg.sizeMin, cfg.sizeMax),
        color: pick(PALETTE),
      });
    }

    const shapesB = shapesA.map((s) => Object.assign({}, s, { present: true }));
    shapesA.forEach((s) => { s.present = true; });

    const mutateIdx = pickDistinctIndices(Math.min(cfg.diffCount, cfg.shapeCount), cfg.shapeCount);
    const diffs = [];
    const mutationTypes = ['color', 'size', 'move', 'remove'];
    const weighted = ['color', 'color', 'color', 'size', 'size', 'size', 'move', 'move', 'remove'];

    mutateIdx.forEach((idx) => {
      const a = shapesA[idx];
      const b = shapesB[idx];
      const mutation = pick(weighted);
      if (mutation === 'color') {
        let newColor = pick(PALETTE);
        while (newColor === a.color) newColor = pick(PALETTE);
        b.color = newColor;
      } else if (mutation === 'size') {
        const grow = Math.random() < 0.5;
        b.size = Math.round(a.size * (grow ? randInt(130, 160) : randInt(55, 75)) / 100);
      } else if (mutation === 'move') {
        const angle = Math.random() * Math.PI * 2;
        const dist = randInt(cfg.moveRange * 0.6, cfg.moveRange);
        b.x = Math.max(a.size, Math.min(canvasW - a.size, a.x + Math.cos(angle) * dist));
        b.y = Math.max(a.size, Math.min(canvasH - a.size, a.y + Math.sin(angle) * dist));
      } else if (mutation === 'remove') {
        b.present = false;
      }
      diffs.push({
        index: idx, mutation, found: false,
        aX: a.x, aY: a.y, aR: a.size,
        bX: b.x, bY: b.y, bR: b.size,
      });
    });

    return { shapesA, shapesB, diffs, canvasW, canvasH };
  }

  function drawShape(ctx, s) {
    if (!s.present) return;
    ctx.fillStyle = s.color;
    if (s.type === 'circle') {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.type === 'square') {
      ctx.fillRect(s.x - s.size, s.y - s.size, s.size * 2, s.size * 2);
    } else if (s.type === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - s.size);
      ctx.lineTo(s.x + s.size, s.y + s.size);
      ctx.lineTo(s.x - s.size, s.y + s.size);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawFoundMarker(ctx, x, y, r) {
    ctx.save();
    ctx.strokeStyle = '#35c48f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function render(canvas, shapes, round, side) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1f2440';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    shapes.forEach((s) => drawShape(ctx, s));
    round.diffs.forEach((d) => {
      if (!d.found) return;
      if (side === 'A') drawFoundMarker(ctx, d.aX, d.aY, d.aR);
      else drawFoundMarker(ctx, d.bX, d.bY, d.bR);
    });
  }

  // Returns the diff object hit by a click at (x, y) on the given side, or
  // null. `tolerance` should come from the same difficulty config used to
  // generate the round.
  function hitTest(round, side, x, y, tolerance) {
    for (const d of round.diffs) {
      if (d.found) continue;
      const cx = side === 'A' ? d.aX : d.bX;
      const cy = side === 'A' ? d.aY : d.bY;
      const r = (side === 'A' ? d.aR : d.bR) + tolerance;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= r) return d;
    }
    return null;
  }

  return { DIFFICULTY, generateRound, render, hitTest };
})();
