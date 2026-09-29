(function () {
  // Runtime chunk composition in bare QuickJS: 256 tiles of 16x16 CLUT8 indices copied
  // row by row into a 256x256 index buffer (what a JS ChunkSource for the PSP would do
  // before uploadTexture), plus the same with a per-cell stack of 2 layers (alpha-keyed
  // upper tile: index 0 = transparent, needs a per-pixel test).
  const T = 16, C = 256, N = 512;
  const tiles = [];
  for (let i = 0; i < N; i++) { const t = new Uint8Array(T * T); for (let p = 0; p < T * T; p++) t[p] = (i * 7 + p * 13) & 255; tiles.push(t); }
  const cells = new Uint16Array(C / T * C / T); for (let i = 0; i < cells.length; i++) cells[i] = (i * 31) % N;
  const upper = new Uint16Array(cells.length); for (let i = 0; i < upper.length; i++) upper[i] = (i % 5 === 0) ? (i * 17) % N : 0;
  const out = new Uint8Array(C * C);
  function composeDense() {
    for (let cy = 0; cy < C / T; cy++) for (let cx = 0; cx < C / T; cx++) {
      const t = tiles[cells[cy * (C / T) + cx]]; const base = cy * T * C + cx * T;
      for (let y = 0; y < T; y++) out.set(t.subarray(y * T, y * T + T), base + y * C);
    }
  }
  function composeWithUpper() {
    composeDense();
    for (let cy = 0; cy < C / T; cy++) for (let cx = 0; cx < C / T; cx++) {
      const v = upper[cy * (C / T) + cx]; if (!v) continue;
      const t = tiles[v]; const base = cy * T * C + cx * T;
      for (let y = 0; y < T; y++) { const o = base + y * C, s = y * T; for (let x = 0; x < T; x++) { const p = t[s + x]; if (p) out[o + x] = p; } }
    }
  }
  const time = (fn, n) => { fn(); const a = __benchNow(); for (let i = 0; i < n; i++) fn(); return (__benchNow() - a) / n; };
  const dense = time(composeDense, 50);
  const withUpper = time(composeWithUpper, 50);
  globalThis.__out = JSON.stringify({ composeDenseMsPerChunk: +dense.toFixed(3), composeDensePlusUpperMsPerChunk: +withUpper.toFixed(3) });
})();
