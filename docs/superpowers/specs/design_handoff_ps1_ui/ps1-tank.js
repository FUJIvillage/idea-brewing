/* ps1-tank — ローポリ回転醸造タンク (PS1風: 低解像度キャンバス + 頂点スナップ + フラットシェーディング) */
(function () {
  if (customElements.get('ps1-tank')) return;

  const N = 9;            // 円周の分割数(ローポリ感)
  const R = 6;            // 胴体の縦リング数(液面の段階表示用)
  const BODY_H = 1.35;

  function buildFaces() {
    const faces = [];
    const ring = (y0, y1, r0, r1, tag) => {
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const a1 = ((i + 1) / N) * Math.PI * 2;
        faces.push({
          v: [
            [Math.cos(a0) * r0, y0, Math.sin(a0) * r0],
            [Math.cos(a1) * r0, y0, Math.sin(a1) * r0],
            [Math.cos(a1) * r1, y1, Math.sin(a1) * r1],
            [Math.cos(a0) * r1, y1, Math.sin(a0) * r1],
          ],
          tag: tag,
        });
      }
    };
    ring(-0.16, 0, 0.7, 0.62, 'dark');                       // 台座スカート
    for (let k = 0; k < R; k++) {                            // 胴体(リング毎に液面判定)
      ring((k / R) * BODY_H, ((k + 1) / R) * BODY_H, 0.58, 0.58, 'body' + k);
    }
    ring(BODY_H, 1.64, 0.58, 0.2, 'steel');                  // 肩(円錐)
    ring(1.64, 1.9, 0.2, 0.2, 'steel');                      // 煙突
    ring(1.9, 1.98, 0.25, 0.25, 'dark');                     // キャップ
    return faces;
  }

  const COLORS = {
    liquid: [235, 152, 30],
    steel: [128, 126, 140],
    dark: [86, 72, 56],
  };
  const BANDS = [0.34, 0.56, 0.78, 1];

  class PS1Tank extends HTMLElement {
    static get observedAttributes() { return ['fill', 'size', 'speed']; }

    connectedCallback() {
      if (!this._canvas) {
        this._canvas = document.createElement('canvas');
        this._canvas.width = 84;
        this._canvas.height = 104;
        this._canvas.style.imageRendering = 'pixelated';
        this._canvas.style.display = 'block';
        this.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');
        this._faces = buildFaces();
        this._t = Math.random() * Math.PI * 2;
        this._last = performance.now();
      }
      this._applySize();
      this._running = true;
      const loop = (now) => {
        if (!this._running || !this.isConnected) return;
        const dt = Math.min(0.05, (now - this._last) / 1000);
        this._last = now;
        this._t += dt * (parseFloat(this.getAttribute('speed')) || 0.85);
        this._draw();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    disconnectedCallback() { this._running = false; }
    attributeChangedCallback() { if (this._canvas) this._applySize(); }

    _applySize() {
      const h = parseFloat(this.getAttribute('size')) || 130;
      this._canvas.style.height = h + 'px';
      this._canvas.style.width = (h * 84 / 104) + 'px';
    }

    _draw() {
      const ctx = this._ctx;
      const W = this._canvas.width, H = this._canvas.height;
      ctx.clearRect(0, 0, W, H);

      const fill = Math.max(0, Math.min(100, parseFloat(this.getAttribute('fill') || '0')));
      const t = this._t;
      const ct = Math.cos(t), st = Math.sin(t);
      const tilt = 0.34, cT = Math.cos(tilt), sT = Math.sin(tilt);
      const d = 3.3, f = 50;
      const lx = 0.45, ly = 0.68, lz = -0.55;
      const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);

      const xform = (p) => {
        const x = p[0] * ct + p[2] * st;
        const z = -p[0] * st + p[2] * ct;
        const y = p[1] - 0.92;
        return [x, y * cT - z * sT, y * sT + z * cT];
      };
      // 頂点スナップ(整数座標に丸める) = PS1のポリゴンジッタ
      const proj = (v) => [
        Math.round(W / 2 + (v[0] * f) / (v[2] + d)),
        Math.round(H * 0.55 - (v[1] * f) / (v[2] + d)),
      ];

      const polys = [];
      for (const face of this._faces) {
        const pv = face.v.map(xform);
        const e1 = [pv[1][0] - pv[0][0], pv[1][1] - pv[0][1], pv[1][2] - pv[0][2]];
        const e2 = [pv[3][0] - pv[0][0], pv[3][1] - pv[0][1], pv[3][2] - pv[0][2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; }   // カメラ側に向ける(裏面は前面で上書き)
        const shade = Math.max(0.05, (nx * lx + ny * ly + nz * lz) / ll);
        const q = BANDS[Math.min(3, Math.floor(shade * 4))];

        let base;
        if (face.tag.indexOf('body') === 0) {
          const k = parseInt(face.tag.slice(4), 10);
          base = ((k + 0.5) / R) * 100 <= fill ? COLORS.liquid : COLORS.steel;
        } else {
          base = COLORS[face.tag];
        }
        const col = base.map((c) => Math.round(c * q));
        const depth = (pv[0][2] + pv[1][2] + pv[2][2] + pv[3][2]) / 4;
        polys.push({ pts: pv.map(proj), col: col, depth: depth });
      }

      polys.sort((a, b) => b.depth - a.depth);
      for (const p of polys) {
        ctx.beginPath();
        ctx.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = 'rgb(' + p.col[0] + ',' + p.col[1] + ',' + p.col[2] + ')';
        ctx.strokeStyle = 'rgb(' + Math.round(p.col[0] * 0.5) + ',' + Math.round(p.col[1] * 0.5) + ',' + Math.round(p.col[2] * 0.5) + ')';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }

      // 煙突から立ちのぼる泡(ピクセル)
      if (fill > 0) {
        for (let i = 0; i < 3; i++) {
          const pr = (t * 0.35 + i / 3) % 1;
          const p = proj(xform([0, 2.05 + pr * 0.6, 0]));
          ctx.globalAlpha = Math.max(0, 1 - pr);
          ctx.fillStyle = i === 1 ? '#fff3d6' : '#ffd88a';
          ctx.fillRect(p[0] + (i - 1) * 3, p[1], 2, 2);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  customElements.define('ps1-tank', PS1Tank);
})();
