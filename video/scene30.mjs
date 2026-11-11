// JevSense 紹介動画（30秒）。時刻 t を渡すと1フレームを描く。
// 0–4 問いかけ / 4–9 察知 / 9–16 設定（ノード編集）/ 16–21.5 判定→表示 / 21.5–24.5 データの持ち方 / 24.5–30 ロゴ
export const W = 1920, H = 1080, DUR = 30;

const SANS = '"Hiragino Sans"', MIN = '"Hiragino Mincho ProN"', LAT = '"Avenir Next"', GEO = "Georgia", MONO = "Menlo";
const CREAM = "#f4f5f0", MINT = "#9ecfaf", MINT2 = "#c9ecd5", LIME = "#c8d86a", JEV = "#b9a8f0";
const DIM = "rgba(220,238,226,.62)", INK = "#1f3a2d", SUB = "#6b7a70", BRAND = "#245b44";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const p = (t, a, b) => clamp((t - a) / (b - a));
const eo = (x) => 1 - Math.pow(1 - x, 3);
const eo5 = (x) => 1 - Math.pow(1 - x, 5);
const ei = (x) => x * x * x;
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const back = (x) => 1 + 2.9 * Math.pow(x - 1, 3) + 1.9 * Math.pow(x - 1, 2);
const lerp = (a, b, x) => a + (b - a) * x;
const rng = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const bez = (a, b, c, d, s) => { const m = 1 - s; return [m * m * m * a[0] + 3 * m * m * s * b[0] + 3 * m * s * s * c[0] + s * s * s * d[0], m * m * m * a[1] + 3 * m * m * s * b[1] + 3 * m * s * s * c[1] + s * s * s * d[1]]; };
// キーフレーム補間: keys = [[t, v1, v2, ...], ...]
const key = (keys, t, ease = eio) => {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const a = keys[i - 1], b = keys[i], x = ease(p(t, a[0], b[0])); return a.slice(1).map((v, j) => lerp(v, b[j + 1], x)); }
  return keys[keys.length - 1].slice(1);
};

export function makeScene(createCanvas) {
  const layer = createCanvas(W, H), lc = layer.getContext("2d");
  const R = rng(7);
  const parts = Array.from({ length: 130 }, () => ({ x: R() * W, y: R() * H, vx: (R() - 0.5) * 26, vy: -6 - R() * 22, r: 0.6 + R() * 2.2, ph: R() * 6.28, sp: 0.6 + R() * 1.6, a: 0.15 + R() * 0.5 }));

  // ---------- helpers ----------
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
  function T(c, s, x, y, font, fill = CREAM, o = {}) {
    c.save(); c.font = font; c.fillStyle = fill; c.textAlign = o.align ?? "left"; c.letterSpacing = (o.ls ?? 0) + "px";
    if (o.a !== undefined) c.globalAlpha *= o.a;
    c.fillText(s, x + (o.align === "center" ? (o.ls ?? 0) / 2 : 0), y); c.restore();
  }
  const TW = (c, s, font, ls = 0) => { c.save(); c.font = font; c.letterSpacing = ls + "px"; const w = c.measureText(s).width; c.restore(); return w; };
  function layout(c, segs, font, ls) {
    c.save(); c.font = font; c.letterSpacing = "0px"; let x = 0; const out = [];
    for (const [s, col] of segs) for (const ch of s) { const w = c.measureText(ch).width; out.push({ ch, x, w, col }); x += w + ls; }
    c.restore(); return { g: out, width: x - ls };
  }
  function glyph(c, g, x0, y, font, k, dy, s0 = 1, blur = 0) {
    if (k <= 0) return;
    c.save(); c.globalAlpha *= k; c.font = font; c.fillStyle = g.col; c.textAlign = "center";
    const b = (1 - k) * blur; if (b > 0.3) c.filter = `blur(${b}px)`;
    c.translate(x0 + g.x + g.w / 2, y + (1 - k) * dy); const s = lerp(s0, 1, k); c.scale(s, s);
    c.fillText(g.ch, 0, 0); c.restore();
  }
  function line(c, segs, cx, y, font, ls, kOf, dy, s0, blur) {
    const L = layout(c, segs, font, ls), x0 = cx - L.width / 2;
    L.g.forEach((g, i) => glyph(c, g, x0, y, font, kOf(i), dy, s0, blur));
  }
  function glass(c, x, y, w, h, r, stroke = "rgba(190,230,205,.2)", glow) {
    c.save(); c.shadowColor = glow ?? "rgba(0,0,0,.5)"; c.shadowBlur = glow ? 50 : 70; c.shadowOffsetY = glow ? 0 : 28; c.fillStyle = "rgba(13,32,24,.94)"; rr(c, x, y, w, h, r); c.fill(); c.restore();
    const g = c.createLinearGradient(x, y, x + w * 0.5, y + h); g.addColorStop(0, "rgba(255,255,255,.1)"); g.addColorStop(1, "rgba(255,255,255,.02)");
    c.fillStyle = g; rr(c, x, y, w, h, r); c.fill();
    c.strokeStyle = stroke; c.lineWidth = 1.5; rr(c, x + 0.75, y + 0.75, w - 1.5, h - 1.5, r); c.stroke();
  }
  function strokeBez(c, P, s0, s1, style, lw) {
    if (s1 <= s0) return; c.beginPath();
    for (let i = 0; i <= 40; i++) { const [x, y] = bez(...P, lerp(s0, s1, i / 40)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.strokeStyle = style; c.lineWidth = lw; c.lineCap = "round"; c.stroke();
  }
  function glowDot(c, x, y, r, col, a) {
    if (a <= 0) return;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 5);
    g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.25, `rgba(${col},${a * 0.5})`); g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 5, 0, 6.283); c.fill();
    c.fillStyle = `rgba(255,255,255,${a})`; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
  }
  function step(c, x, y, no, label, a, dx = 0) {
    if (a <= 0) return; c.save(); c.globalAlpha *= a; c.translate(dx, 0);
    T(c, no, x, y, `600 22px ${LAT}`, MINT, { ls: 6 });
    c.fillStyle = "rgba(158,207,175,.6)"; c.fillRect(x + 56, y - 9, 44, 1.5);
    T(c, label, x + 118, y + 2, `700 28px ${SANS}`, CREAM, { ls: 6 }); c.restore();
  }
  function star(c, x, y, r, fill) { c.fillStyle = fill; c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 - Math.PI / 2, q = i % 2 ? r * 0.36 : r; c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } c.closePath(); c.fill(); }
  function mark(c, cx, cy, size, k, rot, c0, c1, glow) {
    if (k <= 0) return; c.save(); c.translate(cx, cy); c.rotate(rot); c.scale(k, k);
    const g = c.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2); g.addColorStop(0, c0); g.addColorStop(1, c1);
    c.save(); c.shadowColor = glow; c.shadowBlur = size * 0.55; c.shadowOffsetY = size * 0.08; c.fillStyle = g; rr(c, -size / 2, -size / 2, size, size, size * 0.267); c.fill(); c.restore();
    c.strokeStyle = "rgba(210,240,222,.35)"; c.lineWidth = 1.5; rr(c, -size / 2, -size / 2, size, size, size * 0.267); c.stroke();
    T(c, "j.", -size / 2 + size * 0.317, -size / 2 + size * 0.733, `italic ${size * 0.75}px ${GEO}`, "#fff"); c.restore();
  }
  function comp(ctx, o = {}) {
    const { a = 1, s = 1, tx = 0, ty = 0, blur = 0 } = o; if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; if (blur > 0.3) ctx.filter = `blur(${blur}px)`;
    ctx.translate(W / 2 + tx, H / 2 + ty); ctx.scale(s, s); ctx.drawImage(layer, -W / 2, -H / 2); ctx.restore();
  }
  const begin = () => { lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalAlpha = 1; lc.filter = "none"; lc.clearRect(0, 0, W, H); return lc; };
  const A = (c, a, fn) => { if (a <= 0) return; c.save(); c.globalAlpha *= clamp(a); fn(); c.restore(); };
  function caption(c, segs, k, y = 950) {
    if (k <= 0) return; c.save(); c.globalAlpha *= k; const b = (1 - k) * 10; if (b > 0.3) c.filter = `blur(${b}px)`;
    line(c, segs, 960 + 14, y + (1 - k) * 30, `600 62px ${MIN}`, 5, () => 1, 0); c.restore();
  }

  // ---------- background ----------
  function drawBg(c, t) {
    c.fillStyle = "#06110c"; c.fillRect(0, 0, W, H);
    const gx = 960 + Math.sin(t * 0.5) * 260, gy = 500 + Math.cos(t * 0.4) * 120;
    let g = c.createRadialGradient(gx, gy, 0, gx, gy, 1100);
    g.addColorStop(0, "rgba(36,104,74,.6)"); g.addColorStop(0.45, "rgba(16,48,35,.5)"); g.addColorStop(1, "rgba(6,17,12,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    g = c.createRadialGradient(1700, 1100, 0, 1700, 1100, 800); g.addColorStop(0, "rgba(200,216,106,.14)"); g.addColorStop(1, "rgba(200,216,106,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(190,230,205,.1)"; const off = (t * 14) % 48;
    for (let y = -48 + off; y < H + 48; y += 48) for (let x = 24; x < W; x += 48) c.fillRect(x, y, 2, 2);
    for (const q of parts) {
      const x = (((q.x + q.vx * t) % W) + W) % W, y = (((q.y + q.vy * t) % H) + H) % H;
      c.fillStyle = `rgba(201,236,213,${q.a * (0.55 + 0.45 * Math.sin(q.ph + t * q.sp * 2))})`;
      c.beginPath(); c.arc(x, y, q.r, 0, 6.283); c.fill();
    }
  }

  // ================= S1: 問いかけ (0–4) =================
  const trail = [[[-60, 760], [300, 560], [420, 980], [760, 880]], [[760, 880], [1100, 780], [1180, 180], [1500, 230]], [[1500, 230], [1760, 270], [1820, 560], [2000, 470]]];
  // ナレーションの文字ごとの開始時刻（秒）に合わせて文字を出す
  const T1a = [0, 0.24, 0.32, 0.64, 0.96, 1.04, 1.24, 1.44], T1b = [1.52, 1.6, 1.84, 2.16, 2.32, 2.43, 2.53, 2.64, 2.76, 2.88];
  function s1(ctx, t) {
    if (t >= 4.05) return; const c = begin();
    const prog = eio(p(t, 0.05, 3.7)) * 3;
    trail.forEach((P, i) => {
      const s1 = clamp(prog - i); strokeBez(c, P, 0, s1, "rgba(158,207,175,.3)", 2);
      if (s1 > 0 && i > 0) { const [x, y] = P[0]; c.strokeStyle = "rgba(201,236,213,.7)"; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9 + 5 * eo(p(prog - i, 0, 0.5)), 0, 6.283); c.stroke(); glowDot(c, x, y, 3.5, "158,230,185", 0.9); }
    });
    if (prog < 3) { const i = Math.min(2, Math.floor(prog)); const [x, y] = bez(...trail[i], prog - i); glowDot(c, x, y, 6, "170,240,195", 1); }
    const k = eo(p(t, 0.1, 0.7));
    A(c, k * 0.9, () => T(c, "WEB PERSONALIZATION", 960, 300 + lerp(14, 0, k), `600 22px ${LAT}`, MINT, { align: "center", ls: 22 * lerp(1.1, 0.62, eo5(p(t, 0.1, 1.5))) }));
    const F = `600 150px ${MIN}`, kk = (arr) => (i) => eo5(p(t, 0.58 + arr[i], 1.13 + arr[i]));
    line(c, [["その人は、いま、", CREAM]], 960 + 40, 520, F, 8, kk(T1a), 60, 1.2, 14);
    line(c, [["何に", CREAM], ["関心", LIME], ["があるのか。", CREAM]], 960 + 30, 720, F, 8, kk(T1b), 60, 1.2, 14);
    const out = ei(p(t, 3.62, 4.0));
    comp(ctx, { a: 1 - out, s: 1 + 0.16 * out + 0.035 * p(t, 0, 4), blur: out * 18 });
  }

  // ================= S2: 察知 (4–9) =================
  const code = [
    [["<", DIM], ["script", MINT], [" defer", "#e8c98c"]],
    [["  src", "#e8c98c"], ["=", DIM], ['"https://YOUR-API-HOST/sdk.js"', LIME]],
    [["  data-site", "#e8c98c"], ["=", DIM], ['"YOUR-SITE-ID"', LIME]],
    [["></", DIM], ["script", MINT], [">", DIM]],
  ];
  const codeLen = code.flat().reduce((n, [s]) => n + s.length, 0);
  const pages = [["ランニング入門ガイド", "記事", 42], ["吸汗速乾ポロシャツ", "商品", 78], ["通勤ランニングシューズ", "商品", 36]];
  const flows = [300, 450, 600].map((y) => [[570, y + 60], [740, y + 60], [730, 510], [876, 510]]);
  const obs = [["閲覧順序", "どの順で見たか"], ["表示時間", "どれだけ見ていたか"], ["ページ情報", "名称・説明・種類・テーマ"]];
  const oflows = [366, 510, 654].map((y) => [[1044, 510], [1150, 510], [1170, y], [1290, y]]);
  function s2(ctx, t) {
    if (t < 3.95 || t >= 9.05) return; const c = begin(), w = t - 4;
    step(c, 140, 232, "01", "察知", eo(p(w, 0.05, 0.45)), lerp(-30, 0, eo(p(w, 0.05, 0.45))));
    // --- A: 共通タグ ---
    const ain = eo5(p(w, 0.05, 0.6)), aout = ei(p(w, 2.15, 2.5));
    A(c, ain * (1 - aout), () => {
      c.translate(960, 500 + lerp(60, 0, ain) - 50 * aout); const s = lerp(0.94, 1, ain) * (1 - 0.06 * aout); c.scale(s, s); c.translate(-960, -500);
      glass(c, 330, 300, 1260, 400, 26);
      [0, 1, 2].forEach((i) => { c.fillStyle = ["#e37b6f", "#e3c16f", "#7fc98e"][i]; c.globalAlpha *= 1; c.beginPath(); c.arc(370 + i * 26, 340, 7.5, 0, 6.283); c.fill(); });
      T(c, "index.html", 960, 347, `500 20px ${MONO}`, DIM, { align: "center" });
      c.fillStyle = "rgba(190,230,205,.14)"; c.fillRect(330, 378, 1260, 1.5);
      let budget = Math.floor(p(w, 0.35, 1.95) * codeLen), cx = 0, cy = 0;
      code.forEach((ln, i) => { let x = 392; const y = 458 + i * 64; T(c, String(i + 1), 362, y, `400 22px ${MONO}`, "rgba(220,238,226,.28)", { align: "center" });
        for (const [s, col] of ln) { const n = Math.min(budget, s.length); if (n > 0) { const sub = s.slice(0, n); T(c, sub, x, y, `500 38px ${MONO}`, col); x += TW(c, sub, `500 38px ${MONO}`); cx = x; cy = y; } budget -= n; if (budget <= 0) break; } });
      if (cx && Math.floor(w * 3.2) % 2 === 0) { c.fillStyle = LIME; c.fillRect(cx + 4, cy - 34, 4, 42); }
    });
    A(c, eo(p(w, 1.2, 1.7)) * (1 - aout), () => { const lbl = "共通タグを、ひとつ設置するだけ", f = `600 26px ${SANS}`, tw = TW(c, lbl, f, 3) + 56; c.fillStyle = MINT; rr(c, 960 - tw / 2, 742, tw, 52, 26); c.fill(); T(c, lbl, 960, 777, f, "#0c2018", { align: "center", ls: 3 }); });
    // --- B: 閲覧の観測 ---
    const b = w - 2.3;
    if (b > 0) {
      flows.forEach((P, i) => {
        const s1 = eo(p(b, 0.3 + i * 0.1, 0.85 + i * 0.1)); strokeBez(c, P, 0, s1, "rgba(158,207,175,.38)", 2);
        if (b > 0.45) for (let k = 0; k < 4; k++) { const s = ((b - 0.45) * 0.9 + k / 4 + i * 0.13) % 1; if (s > s1) continue; const [x, y] = bez(...P, s); glowDot(c, x, y, 4, "170,240,195", Math.sqrt(Math.sin(s * Math.PI))); }
      });
      oflows.forEach((P, i) => {
        const on = 0.8 + i * 0.3; strokeBez(c, P, 0, eo(p(b, on - 0.25, on + 0.1)), "rgba(200,216,106,.55)", 2.5);
        if (b > on) for (let k = 0; k < 2; k++) { const s = ((b - on) * 1.2 + k / 2) % 1; const [x, y] = bez(...P, s); glowDot(c, x, y, 3.5, "215,230,130", Math.sqrt(Math.sin(s * Math.PI))); }
      });
      pages.forEach(([title, kind, sec], i) => {
        const a = 0.02 + i * 0.13, k = eo5(p(b, a, a + 0.55)), y = 300 + i * 150;
        A(c, k, () => {
          c.translate(lerp(-120, 0, k), 0); glass(c, 140, y, 430, 120, 22);
          c.fillStyle = "rgba(158,207,175,.14)"; rr(c, 166, y + 33, 54, 54, 16); c.fill(); c.strokeStyle = "rgba(158,207,175,.45)"; c.lineWidth = 1.2; c.stroke();
          T(c, String(i + 1), 193, y + 69, `600 24px ${LAT}`, MINT2, { align: "center" });
          T(c, title, 244, y + 56, `600 27px ${SANS}`, CREAM, { ls: 0.5 });
          T(c, `${kind} ・ 閲覧 ${Math.round(sec * eo(p(b, a + 0.1, a + 1.0)))}秒`, 244, y + 92, `400 19px ${SANS}`, DIM, { ls: 0.8 });
        });
      });
      [0, 0.5].forEach((d) => { if (b <= 0.5) return; const q = ((b - 0.5) * 1.1 + d) % 1; c.strokeStyle = `rgba(158,207,175,${(1 - q) * 0.7})`; c.lineWidth = 1.5; c.beginPath(); c.arc(960, 510, 80 * (1 + q * 1.9), 0, 6.283); c.stroke(); });
      const o = p(b, 0.15, 0.65);
      A(c, o * 3, () => mark(c, 960, 510, 160, lerp(0.3, 1, back(o)) * (1 + 0.035 * Math.sin(b * 9)), 0, "#317a5b", "#1b4735", "rgba(90,210,145,.75)"));
      obs.forEach(([h, d], i) => {
        const on = 0.8 + i * 0.3, k = eo5(p(b, on - 0.3, on + 0.25)), lit = eo(p(b, on, on + 0.3)), y = 318 + i * 144;
        A(c, k, () => {
          c.translate(lerp(90, 0, k), 0); glass(c, 1290, y, 490, 96, 22, `rgba(200,216,106,${lerp(0.2, 0.75, lit)})`, lit > 0 ? `rgba(200,216,106,${0.22 * lit})` : undefined);
          c.strokeStyle = LIME; c.lineWidth = 3; c.lineCap = "round"; c.lineJoin = "round"; c.beginPath(); c.moveTo(1320, y + 49); c.lineTo(1330, y + 59); c.lineTo(1350, y + 37); c.globalAlpha *= lit; c.stroke(); c.globalAlpha /= Math.max(lit, 1e-6);
          T(c, h, 1376, y + 46, `700 28px ${SANS}`, CREAM, { ls: 2 });
          T(c, d, 1376, y + 76, `400 18px ${SANS}`, DIM, { ls: 0.8 });
        });
      });
    }
    caption(c, [["タグひとつで、閲覧の文脈を", CREAM], ["察知", LIME], ["。", CREAM]], eo(p(w, 2.5, 3.1)));
    const out = ei(p(t, 8.72, 9.0));
    comp(ctx, { a: eo(p(t, 3.95, 4.3)) * (1 - out), s: 1 + 0.02 * p(w, 0, 5), tx: -90 * out, blur: out * 10 });
  }

  // ================= S3: 設定・ノード編集 (9–16) =================
  const QTEXT = "吸汗速乾機能のあるポロシャツに関心がある";
  const cam = [[9.0, 960, 500, 0.9], [9.65, 790, 330, 1.5], [11.2, 810, 330, 1.5], [11.85, 800, 612, 1.28], [13.45, 800, 612, 1.28], [14.1, 985, 560, 1.07], [16, 1000, 566, 1.1]];
  const wire = (a, b) => [a, [a[0], a[1] + 46], [b[0], b[1] - 46], b];
  const W1 = wire([440, 512], [610, 560]), W2 = wire([830, 512], [670, 560]), W3 = wire([640, 680], [640, 736]);
  function lnode(c, x, y, w, h, tint, tcol, title, lines, k, chip, chipK, ok, hl, hasStar) {
    if (k <= 0) return; c.save(); c.globalAlpha *= clamp(k * 3);
    c.translate(x + w / 2, y + h / 2); const s = lerp(0.55, 1, back(k)); c.scale(s, s); c.translate(-w / 2, -h / 2);
    c.save(); c.shadowColor = hl > 0 ? `rgba(52,123,89,${0.45 * hl})` : "rgba(31,58,45,.16)"; c.shadowBlur = hl > 0 ? 34 : 24; c.shadowOffsetY = hl > 0 ? 0 : 10; c.fillStyle = "#fff"; rr(c, 0, 0, w, h, 14); c.fill(); c.restore();
    c.save(); rr(c, 0, 0, w, h, 14); c.clip(); c.fillStyle = tint; c.fillRect(0, 0, w, 40); c.restore();
    if (hasStar) star(c, 24, 20, 7, tcol);
    T(c, title, hasStar ? 38 : 16, 27, `700 16px ${SANS}`, tcol, { ls: 0.8 });
    lines.forEach((b, i) => T(c, b, 16, 70 + i * 27, `600 18.5px ${SANS}`, INK, { ls: 0.2 }));
    c.strokeStyle = hl > 0 ? `rgba(36,91,68,${lerp(0.25, 1, hl)})` : "#d5dbd0"; c.lineWidth = lerp(1.5, 2.6, hl); rr(c, 0, 0, w, h, 14); c.stroke();
    if (chipK > 0) { const f = `700 14px ${SANS}`, tw = TW(c, chip, f, 0.6) + 22; c.globalAlpha *= clamp(chipK); const cs = lerp(0.6, 1, back(clamp(chipK))); c.translate(16, h - 24); c.scale(cs, cs); c.fillStyle = ok ? "#dff0e5" : "#eef0ea"; rr(c, 0, -14, tw, 28, 7); c.fill(); T(c, chip, 11, 5, f, ok ? "#2c6a4d" : "#7b867e", { ls: 0.6 }); }
    c.restore();
  }
  function port(c, x, y, k) { if (k <= 0) return; c.save(); c.globalAlpha *= clamp(k); c.fillStyle = "#fff"; c.strokeStyle = "#8fa698"; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 8, 0, 6.283); c.fill(); c.stroke(); c.restore(); }
  function cursor(c, x, y, a, press) { if (a <= 0) return; c.save(); c.globalAlpha *= a; c.translate(x, y); const s = 1.5 * (1 - 0.14 * press); c.scale(s, s); c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = 8; c.shadowOffsetY = 3; c.beginPath(); [[0, 0], [0, 25], [6.5, 19.5], [11, 30], [15.5, 28], [11, 18], [19.5, 18]].forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath(); c.fillStyle = "#14251d"; c.fill(); c.shadowColor = "transparent"; c.strokeStyle = "#fff"; c.lineWidth = 1.8; c.lineJoin = "round"; c.stroke(); c.restore(); }
  function s3(ctx, t) {
    if (t < 8.95 || t >= 16.05) return; const c = begin();
    const [cx, cy, z] = key(cam, t), wi = eo5(p(t, 8.98, 9.6));
    c.save(); c.globalAlpha = wi; c.translate(960, 540 + lerp(140, 0, wi)); c.scale(z, z); c.translate(-cx, -cy);
    // ウィンドウ
    c.save(); c.shadowColor = "rgba(0,0,0,.6)"; c.shadowBlur = 110; c.shadowOffsetY = 46; c.fillStyle = "#f4f5f0"; rr(c, 160, 110, 1600, 780, 20); c.fill(); c.restore();
    c.save(); rr(c, 160, 110, 1600, 780, 20); c.clip();
    c.fillStyle = "#fdfdfb"; c.fillRect(160, 110, 1600, 62); c.fillStyle = "#e3e7de"; c.fillRect(160, 171, 1600, 1.5);
    c.fillStyle = BRAND; rr(c, 188, 124, 34, 34, 9); c.fill(); T(c, "j.", 199, 149, `italic 26px ${GEO}`, "#fff");
    T(c, "JevSense", 234, 149, `700 22px ${LAT}`, INK, { ls: -0.8 }); T(c, ".", 234 + TW(c, "JevSense", `700 22px ${LAT}`, -0.8), 149, `700 22px ${LAT}`, "#9aa93a");
    T(c, "Atelier Store　/　施策一覧　/　夏のポロシャツ特集", 400, 148, `500 15px ${SANS}`, SUB, { ls: 0.6 });
    c.strokeStyle = "#cfd6cb"; c.lineWidth = 1.2; rr(c, 1490, 124, 116, 36, 9); c.stroke(); T(c, "下書き保存", 1548, 148, `600 14px ${SANS}`, INK, { align: "center", ls: 0.5 });
    c.fillStyle = BRAND; rr(c, 1618, 124, 116, 36, 9); c.fill(); T(c, "配信開始", 1676, 148, `700 14px ${SANS}`, "#fff", { align: "center", ls: 0.8 });
    T(c, "条件をつないで、届ける人を決める。", 192, 222, `700 29px ${SANS}`, INK, { ls: 0.4 });
    // 入力欄
    const typing = t > 9.6 && t < 11.45, n = Math.floor(p(t, 9.75, 11.25) * QTEXT.length);
    c.fillStyle = "#fff"; rr(c, 190, 244, 1540, 84, 14); c.fill(); c.strokeStyle = "#dfe3da"; c.lineWidth = 1.5; c.stroke();
    T(c, "どんな関心・状態に当てはまる人ですか？", 214, 293, `700 18px ${SANS}`, INK, { ls: 0.3 });
    c.save(); if (typing) { c.shadowColor = "rgba(52,123,89,.45)"; c.shadowBlur = 16; } c.fillStyle = "#fff"; rr(c, 600, 260, 1106, 52, 10); c.fill(); c.restore();
    c.strokeStyle = typing ? "#347b59" : "#cfd6cb"; c.lineWidth = typing ? 2.2 : 1.4; rr(c, 600, 260, 1106, 52, 10); c.stroke();
    const typed = QTEXT.slice(0, n), tf = `500 22px ${SANS}`; T(c, typed, 620, 294, tf, INK, { ls: 0.4 });
    if (typing && (n < QTEXT.length || Math.floor(t * 3) % 2 === 0)) { c.fillStyle = "#245b44"; c.fillRect(622 + TW(c, typed, tf, 0.4), 272, 2.5, 28); }
    // キャンバス
    c.fillStyle = "#fbfbf8"; rr(c, 190, 346, 1040, 524, 14); c.fill(); c.strokeStyle = "#dfe3da"; c.lineWidth = 1.5; c.stroke();
    c.save(); rr(c, 190, 346, 1040, 524, 14); c.clip(); c.fillStyle = "#dde2d8"; for (let y = 362; y < 870; y += 24) for (let x = 206; x < 1230; x += 24) c.fillRect(x, y, 2, 2); c.restore();
    // 線
    const d1 = eio(p(t, 12.15, 12.5)), d2 = eio(p(t, 12.75, 13.1)), d3 = eio(p(t, 13.2, 13.45));
    const ev1 = eo(p(t, 14.3, 14.6)), ev3 = eo(p(t, 14.65, 14.9));
    strokeBez(c, W1, 0, d1, ev1 > 0 ? "#347b59" : "#9db3a6", lerp(3, 4, ev1));
    strokeBez(c, W2, 0, d2, "#9db3a6", 3);
    strokeBez(c, W3, 0, d3, ev3 > 0 ? "#347b59" : "#9db3a6", lerp(3, 4, ev3));
    const pulse = (P, a, b) => { const s = p(t, a, b); if (s > 0 && s < 1) { const [x, y] = bez(...P, eio(s)); glowDot(c, x, y, 5, "90,190,130", 1); c.fillStyle = "#c8d86a"; c.beginPath(); c.arc(x, y, 6, 0, 6.283); c.fill(); } };
    pulse(W1, 14.3, 14.62); pulse(W3, 14.65, 14.92);
    // ノード
    const pop = (on) => p(t, on, on + 0.4);
    lnode(c, 480, 736, 320, 120, "#e1f0e6", "#245b44", "表示対象の判定", ["最終結果"], pop(11.4), "条件を満たす", p(t, 14.95, 15.2), true, eo(p(t, 14.95, 15.2)));
    lnode(c, 280, 362, 320, 150, "#ece8fb", "#5b4a9a", "Jev条件", ["吸汗速乾機能のあるポロシャツに", "関心がある"], pop(11.5), "判定値 0.86 ・ 条件を満たす", p(t, 14.3, 14.55), true, eo(p(t, 14.3, 14.55)), true);
    lnode(c, 680, 362, 300, 150, "#e2edf9", "#2f5f8f", "URL条件", ["流入ページの cid が", "runner を含む"], pop(11.7), "該当なし", p(t, 14.3, 14.55), false, 0);
    lnode(c, 530, 560, 220, 120, "#f7eedb", "#7a5a1c", "OR", ["どれかを満たす"], pop(11.9), "条件を満たす", p(t, 14.65, 14.9), true, eo(p(t, 14.65, 14.9)));
    [[440, 512, 11.75], [830, 512, 11.95], [610, 560, 12.15], [670, 560, 12.15], [640, 680, 12.15], [640, 736, 11.7]].forEach(([x, y, on]) => port(c, x, y, p(t, on, on + 0.2)));
    // 右パネル
    c.fillStyle = "#fff"; rr(c, 1250, 346, 480, 524, 14); c.fill(); c.strokeStyle = "#dfe3da"; c.lineWidth = 1.5; c.stroke();
    c.strokeStyle = "#d5dbd0"; c.lineWidth = 1.3; rr(c, 1274, 366, 210, 44, 9); c.stroke(); T(c, "条件の編集", 1379, 395, `600 16px ${SANS}`, INK, { align: "center", ls: 0.5 });
    c.fillStyle = "#e1f0e6"; rr(c, 1496, 366, 210, 44, 9); c.fill(); c.strokeStyle = "#9fc5ae"; c.stroke(); T(c, "テスト", 1601, 395, `700 16px ${SANS}`, "#245b44", { align: "center", ls: 1 });
    T(c, "この設定を試す", 1274, 452, `700 22px ${SANS}`, INK, { ls: 0.4 });
    T(c, "流入ページのURL", 1274, 490, `600 15px ${SANS}`, SUB, { ls: 0.4 });
    c.strokeStyle = "#cfd6cb"; c.lineWidth = 1.3; rr(c, 1274, 502, 432, 44, 8); c.stroke(); T(c, "https://www.example.com/products/polo", 1290, 530, `500 16px ${LAT}`, INK);
    T(c, "Jevの判定値を試す", 1274, 582, `600 15px ${SANS}`, SUB, { ls: 0.4 });
    T(c, "ポロシャツに関心がある", 1274, 620, `500 17px ${SANS}`, INK, { ls: 0.3 }); rr(c, 1600, 594, 106, 42, 8); c.stroke(); T(c, "0.86", 1653, 622, `600 19px ${LAT}`, INK, { align: "center" });
    const press = Math.sin(p(t, 14.12, 14.36) * Math.PI);
    c.save(); c.translate(1490, 677); c.scale(1 - 0.035 * press, 1 - 0.035 * press); c.fillStyle = press > 0 ? "#1b4735" : BRAND; rr(c, -216, -27, 432, 54, 10); c.fill(); T(c, "テストを実行", 0, 7, `700 19px ${SANS}`, "#fff", { align: "center", ls: 1.4 }); c.restore();
    const rip = p(t, 14.2, 14.7); if (rip > 0 && rip < 1) { c.strokeStyle = `rgba(200,216,106,${1 - rip})`; c.lineWidth = 4; c.beginPath(); c.arc(1640, 692, 14 + rip * 90, 0, 6.283); c.stroke(); }
    const res = eo(p(t, 15.0, 15.35));
    c.save(); if (res > 0) { c.shadowColor = `rgba(170,200,60,${0.75 * res})`; c.shadowBlur = 36; } c.fillStyle = res > 0 ? "#e1f0e6" : "#f6f7f3"; rr(c, 1274, 722, 432, 124, 12); c.fill(); c.restore();
    c.strokeStyle = res > 0 ? `rgba(120,160,40,${res})` : "#dfe3da"; c.lineWidth = res > 0 ? 2.5 : 1.3; if (res <= 0) c.setLineDash([6, 6]); rr(c, 1274, 722, 432, 124, 12); c.stroke(); c.setLineDash([]);
    if (res <= 0) T(c, "結果はここに表示されます", 1490, 790, `500 15px ${SANS}`, "#9aa59c", { align: "center", ls: 0.5 });
    A(c, res, () => { c.translate(0, lerp(10, 0, res)); T(c, "表示対象の条件を満たします", 1298, 774, `700 22px ${SANS}`, INK, { ls: 0.4 }); T(c, "ノードと線で条件ごとの結果を確認できます。", 1298, 810, `400 14.5px ${SANS}`, "#5b6b60", { ls: 0.3 }); });
    c.restore();
    // カーソル
    const cur = key([[11.9, 760, 640], [12.15, 440, 512], [12.5, 610, 560], [12.75, 830, 512], [13.1, 670, 560], [13.2, 640, 680], [13.45, 640, 736], [13.6, 660, 760], [14.1, 1640, 692], [16, 1640, 692]], t);
    cursor(c, cur[0], cur[1], p(t, 11.85, 12.05), Math.max(press, d1 > 0 && d1 < 1 ? 1 : 0, d2 > 0 && d2 < 1 ? 1 : 0, d3 > 0 && d3 < 1 ? 1 : 0));
    c.restore();
    step(c, 110, 86, "02", "設定", eo(p(t, 9.1, 9.5)) * (1 - p(t, 9.5, 9.8)) + eo(p(t, 13.6, 14.1)) * 0);
    const cseg = t < 13.75 ? [["言葉で書いて、", CREAM], ["ノードでつなぐ", LIME], ["だけ。", CREAM]] : [["配信の前に、", CREAM], ["結果をテスト", LIME], ["。", CREAM]];
    caption(c, cseg, t < 13.75 ? eo(p(t, 11.95, 12.4)) * (1 - p(t, 13.5, 13.75)) : eo(p(t, 13.8, 14.25)), 1000);
    const out = ei(p(t, 15.72, 16.0));
    comp(ctx, { a: 1 - out, tx: -90 * out, blur: out * 10 });
  }

  // ================= S4: 判定 → 表示 (16–21.5) =================
  function s4(ctx, t) {
    if (t < 15.95 || t >= 21.55) return; const c = begin(), u = t - 16;
    const q = eo5(p(u, 0.1, 0.65)), v = 0.86 * eo(p(u, 0.55, 1.6)), fl = p(u, 1.8, 2.5), mv = eio(p(u, 1.95, 2.6));
    A(c, q, () => {
      c.translate(lerp(960, 360, mv), lerp(530, 510, mv) + lerp(60, 0, q)); const gs = lerp(1.32, 1, mv); c.scale(gs, gs); c.translate(-1540, -510);
      step(c, 1290, 280, "03", "判定", 1);
      glass(c, 1290, 318, 500, 384, 22, fl > 0 ? `rgba(200,216,106,${lerp(0.95, 0.4, fl)})` : undefined, fl > 0 ? `rgba(200,216,106,${lerp(0.5, 0.12, fl)})` : undefined);
      c.fillStyle = JEV; rr(c, 1324, 348, 150, 38, 19); c.fill(); star(c, 1348, 367, 9, "#1b1433"); T(c, "Jev条件", 1364, 374, `700 20px ${SANS}`, "#1b1433", { ls: 1.5 });
      T(c, "吸汗速乾機能のあるポロシャツに", 1324, 446, `600 30px ${SANS}`, CREAM, { ls: 0.6 });
      T(c, "関心がある？", 1324, 492, `600 30px ${SANS}`, CREAM, { ls: 0.6 });
      T(c, "判定値", 1324, 600, `400 19px ${SANS}`, DIM, { ls: 2.4 });
      T(c, v.toFixed(2), 1756, 612, `600 92px ${LAT}`, v >= 0.7 ? MINT2 : CREAM, { align: "right", ls: -2 });
      c.fillStyle = "rgba(255,255,255,.1)"; rr(c, 1324, 640, 432, 10, 5); c.fill();
      if (v > 0.012) { const g = c.createLinearGradient(1324, 0, 1756, 0); g.addColorStop(0, "#4fae7f"); g.addColorStop(1, "#c9ecd5"); c.save(); c.shadowColor = "rgba(120,220,160,.8)"; c.shadowBlur = 22; c.fillStyle = g; rr(c, 1324, 640, 432 * v, 10, 5); c.fill(); c.restore(); }
      c.fillStyle = LIME; c.fillRect(1324 + 432 * 0.7 - 1, 631, 2, 28);
      T(c, "しきい値", 1324 + 432 * 0.7, 684, `500 16px ${SANS}`, LIME, { align: "center", ls: 1.2 });
      const y = p(u, 1.8, 2.1);
      A(c, y * 4, () => { c.translate(1736, 314); c.rotate(0.105); const s = lerp(2.4, 1, eo5(y)); c.scale(s, s); c.save(); c.shadowColor = "rgba(200,216,106,.8)"; c.shadowBlur = 70; c.fillStyle = LIME; rr(c, -88, -39, 176, 78, 16); c.fill(); c.restore(); T(c, "YES", 0, 18, `700 50px ${LAT}`, "#1a2408", { align: "center", ls: 5 }); });
    });
    const e4 = eio(p(u, 2.5, 3.0));
    for (let i = 0; i < 8; i++) { const s = (i / 8 + u * 0.5) % 1; if (s > e4) continue; c.fillStyle = LIME; c.beginPath(); c.arc(lerp(618, 728, s), 510, 3, 0, 6.283); c.fill(); }
    step(c, 730, 142, "04", "表示", eo(p(u, 2.0, 2.4)));
    const fk = eo(p(u, 2.3, 2.7));
    A(c, fk, () => { let x = 990; c.translate(0, lerp(14, 0, fk)); for (const [s, on] of [["モーダル", 0], ["フローティング", 1], ["通知バー", 0], ["独自JavaScript", 0]]) { const f = `600 18px ${SANS}`, w = TW(c, s, f, 1.4) + 36; rr(c, x, 112, w, 40, 20); if (on) { c.fillStyle = MINT; c.fill(); } else { c.strokeStyle = "rgba(190,230,205,.32)"; c.lineWidth = 1.2; c.stroke(); } T(c, s, x + 18, 139, f, on ? "#0c2018" : "rgba(220,238,226,.78)", { ls: 1.4 }); x += w + 12; } });
    const b = eo5(p(u, 1.95, 2.6));
    A(c, b, () => {
      c.translate(-70, -6); c.translate(1305, 496 + lerp(80, 0, b)); const s = lerp(0.94, 1, b); c.scale(s, s); c.translate(-1305, -496);
      c.save(); c.shadowColor = "rgba(0,0,0,.6)"; c.shadowBlur = 110; c.shadowOffsetY = 46; c.fillStyle = "#fbfbf8"; rr(c, 800, 176, 1080, 660, 22); c.fill(); c.restore();
      c.save(); rr(c, 800, 176, 1080, 660, 22); c.clip();
      c.fillStyle = "#e9ece4"; c.fillRect(800, 176, 1080, 56);
      [0, 1, 2].forEach((i) => { c.fillStyle = "#c6cbbf"; c.beginPath(); c.arc(828.5 + i * 22, 204, 6.5, 0, 6.283); c.fill(); });
      c.fillStyle = "#fbfbf8"; rr(c, 906, 188, 950, 32, 9); c.fill(); T(c, "www.example.com/products/quick-dry-polo", 922, 210, `500 16px ${LAT}`, "#66736a", { ls: 0.3 });
      const g = c.createLinearGradient(844, 276, 1244, 716); g.addColorStop(0, "#dfe8dc"); g.addColorStop(0.55, "#b9d2c1"); g.addColorStop(1, "#8fb9a2"); c.fillStyle = g; rr(c, 844, 276, 420, 470, 16); c.fill();
      c.save(); c.translate(854, 291); c.fillStyle = "rgba(255,255,255,.75)"; c.beginPath(); c.moveTo(140, 110); c.lineTo(176, 92); c.quadraticCurveTo(200, 122, 224, 92); [[260, 110], [318, 160], [286, 204], [262, 186], [262, 348], [138, 348], [138, 186], [114, 204], [82, 160]].forEach(([x, y]) => c.lineTo(x, y)); c.closePath(); c.fill();
      c.fillStyle = "rgba(36,91,68,.25)"; c.beginPath(); c.moveTo(176, 92); c.quadraticCurveTo(200, 122, 224, 92); c.lineTo(212, 150); c.lineTo(200, 128); c.lineTo(188, 150); c.closePath(); c.fill(); c.restore();
      T(c, "吸汗速乾ポロシャツ", 1310, 320, `700 34px ${SANS}`, "#1d2a23", { ls: 0.6 });
      T(c, "¥4,900", 1310, 368, `600 26px ${LAT}`, "#245b44");
      [[404, 480], [438, 430], [472, 320]].forEach(([y, w]) => { c.fillStyle = "#e3e7de"; rr(c, 1310, y, w, 18, 9); c.fill(); });
      const o = p(u, 3.55, 4.0), og = p(u, 3.55, 4.5), ox = 70, oy = 20;
      c.translate(ox, oy);
      if (og > 0 && og < 1) { c.save(); c.globalAlpha *= 1 - og; c.strokeStyle = LIME; c.lineWidth = 3; c.shadowColor = LIME; c.shadowBlur = 40; const e = og * 26; rr(c, 1344 - e, 590 - e, 440 + e * 2, 200 + e * 2, 20 + e); c.stroke(); c.restore(); }
      A(c, o * 4, () => {
        c.translate(1784, 790 + lerp(60, 0, eo5(o))); const s2 = lerp(0.7, 1, back(o)); c.scale(s2, s2); c.translate(-1784, -790);
        c.save(); c.shadowColor = "rgba(18,50,36,.4)"; c.shadowBlur = 60; c.shadowOffsetY = 24; c.fillStyle = "#fff"; rr(c, 1344, 590, 440, 200, 20); c.fill(); c.restore();
        c.strokeStyle = "rgba(36,91,68,.16)"; c.lineWidth = 1; rr(c, 1344, 590, 440, 200, 20); c.stroke();
        T(c, "SPECIAL FEATURE", 1368, 628, `700 14px ${LAT}`, "#347b59", { ls: 2.4 });
        T(c, "吸汗速乾ポロシャツ特集", 1368, 666, `700 27px ${SANS}`, "#1d2a23", { ls: 0.5 });
        T(c, "汗ばむ日も、さらりと快適に。", 1368, 700, `400 18px ${SANS}`, "#5b695f", { ls: 0.4 });
        c.fillStyle = "#245b44"; rr(c, 1368, 722, 150, 44, 12); c.fill(); T(c, "特集を見る", 1443, 751, `700 18px ${SANS}`, "#fff", { align: "center", ls: 1.2 });
      });
      c.restore();
    });
    caption(c, [["用意した案内を、", CREAM], ["ちょうどいい場面", LIME], ["で。", CREAM]], eo(p(u, 2.3, 2.9)), 968);
    const out = ei(p(t, 21.22, 21.5));
    comp(ctx, { a: eo(p(t, 15.95, 16.3)) * (1 - out), s: 1 + 0.02 * p(u, 0, 5.5), tx: lerp(90, 0, eo5(p(t, 15.95, 16.5))) - 90 * out, blur: out * 10 });
  }

  // ================= S5: データの持ち方 (21.5–24.5) =================
  function s5(ctx, t) {
    if (t < 21.45 || t >= 25.2) return; const c = begin(), x = t - 21.5;
    line(c, [["閲覧者IDは、サーバーに", CREAM], ["持たない", LIME], ["。", CREAM]], 960 + 20, 300, `600 88px ${MIN}`, 5, (i) => eo5(p(x, 0.0 + i * 0.04, 0.5 + i * 0.04)), 40, 1.15, 12);
    const l = eo5(p(x, 0.12, 0.72)), r = eo5(p(x, 0.26, 0.86));
    A(c, l, () => {
      c.translate(lerp(-80, 0, l), 0); glass(c, 230, 400, 640, 290, 26, "rgba(158,207,175,.7)", "rgba(90,210,145,.28)");
      T(c, "閲覧者のブラウザ", 270, 462, `700 32px ${SANS}`, CREAM, { ls: 1.5 }); T(c, "sessionStorage", 270, 500, `500 20px ${MONO}`, MINT);
      let px = 270; for (const [s, on] of [["閲覧履歴", 0.9], ["表示済み状態", 1.05]]) { const f = `700 26px ${SANS}`, w = TW(c, s, f, 1.5) + 52, k = p(x, on, on + 0.35); A(c, k * 3, () => { c.translate(px + w / 2, 596); const sc = lerp(0.6, 1, back(k)); c.scale(sc, sc); c.fillStyle = MINT; rr(c, -w / 2, -32, w, 64, 32); c.fill(); T(c, s, 0, 10, f, "#0c2018", { align: "center", ls: 1.5 }); }); px += w + 18; }
    });
    A(c, r, () => {
      c.translate(lerp(80, 0, r), 0); glass(c, 1050, 400, 640, 290, 26);
      T(c, "サーバー", 1090, 462, `700 32px ${SANS}`, CREAM, { ls: 1.5 }); T(c, "持たないもの", 1090, 500, `500 20px ${SANS}`, DIM, { ls: 1 });
      let px = 1090; ["閲覧者ID", "セッション", "行動履歴DB"].forEach((s, i) => { const f = `600 24px ${SANS}`, w = TW(c, s, f, 1) + 40, k = eo(p(x, 1.0 + i * 0.16, 1.3 + i * 0.16)); c.strokeStyle = `rgba(220,238,226,${lerp(0.5, 0.2, k)})`; c.lineWidth = 1.5; rr(c, px, 564, w, 64, 32); c.stroke(); T(c, s, px + w / 2, 605, f, `rgba(244,245,240,${lerp(0.9, 0.38, k)})`, { align: "center", ls: 1 }); if (k > 0) { c.strokeStyle = "#e58a7c"; c.lineWidth = 3.5; c.lineCap = "round"; c.beginPath(); c.moveTo(px + 12, 596); c.lineTo(px + 12 + (w - 24) * k, 596); c.stroke(); } px += w + 14; });
    });
    const ar = eo(p(x, 0.8, 1.3));
    A(c, ar, () => { for (let i = 0; i < 7; i++) { const s = (i / 7 + x * 0.35) % 1; c.fillStyle = `rgba(200,216,106,${Math.sin(s * Math.PI)})`; c.beginPath(); c.arc(lerp(890, 1030, s), 545, 3.5, 0, 6.283); c.fill(); } T(c, "判断のときだけ", 960, 510, `600 17px ${SANS}`, LIME, { align: "center", ls: 1.5 }); });
    const chips = ["セルフホスト", "Cloudflare Workers ・ Node.js", "APIキーは AES-256-GCM で暗号化", "診断パネル"], f = `600 22px ${SANS}`, ws = chips.map((s) => TW(c, s, f, 1.2) + 52), tot = ws.reduce((a, b) => a + b, 0) + 16 * (chips.length - 1);
    let px = 960 - tot / 2; chips.forEach((s, i) => { const k = eo5(p(x, 1.45 + i * 0.12, 1.95 + i * 0.12)); A(c, k, () => { c.translate(0, lerp(26, 0, k)); c.strokeStyle = "rgba(190,230,205,.4)"; c.lineWidth = 1.3; c.fillStyle = "rgba(255,255,255,.05)"; rr(c, px, 790, ws[i], 56, 28); c.fill(); c.stroke(); T(c, s, px + 26, 826, f, MINT2, { ls: 1.2 }); }); px += ws[i] + 16; });
    comp(ctx, { a: eo(p(t, 21.45, 21.8)), s: 1 + 0.025 * p(x, 0, 3), tx: lerp(90, 0, eo5(p(t, 21.45, 22.0))) });
  }

  // ================= S6: ロゴ (24.5–30) =================
  function s6(ctx, t) {
    const v = t - 24.5; if (v <= 0) return; const c = begin();
    c.fillStyle = CREAM; c.fillRect(0, 0, W, H);
    for (const [x, y, r, col] of [[960, 500, 900, "rgba(255,255,255,1)"], [1540, 1190, 1000, "rgba(36,91,68,.16)"], [190, -110, 800, "rgba(200,216,106,.24)"]]) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, "0)")); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    c.translate(960, 540); const z = 1 + 0.035 * p(v, 0, 5.5); c.scale(z, z); c.translate(-960, -540);
    // ロックアップ（「ジェブセンス」の発話で脈動）
    const pu = p(v, 3.37, 4.07), pulse = 1 + 0.07 * Math.sin(pu * Math.PI) * (1 - pu * 0.3);
    if (pu > 0 && pu < 1) { c.strokeStyle = `rgba(154,169,58,${(1 - pu) * 0.8})`; c.lineWidth = 3; c.beginPath(); c.ellipse(960, 268, 420 + pu * 220, 120 + pu * 90, 0, 0, 6.283); c.stroke(); }
    c.save(); c.translate(960, 268); c.scale(0.74 * pulse, 0.74 * pulse); c.translate(-960, -395);
    const F = `700 176px ${LAT}`, L = layout(c, [["JevSense", INK], [".", "#9aa93a"]], F, -6), total = 190 + 40 + L.width, x0 = 960 - total / 2;
    const m = p(v, 0.2, 0.75); A(c, m * 3, () => mark(c, x0 + 95, 395, 190, lerp(0.2, 1, back(m)), lerp(-0.32, 0, eo5(m)), "#2a6a4f", "#245b44", "rgba(36,91,68,.4)"));
    L.g.forEach((g, i) => glyph(c, g, x0 + 230, 456, F, eo5(p(v, 0.36 + i * 0.045, 0.86 + i * 0.045)), 60, 1, 10));
    c.restore();
    const TF = `600 112px ${MIN}`;
    line(c, [["届けたい相手を、", INK]], 960 + 30, 560, TF, 10, (i) => eo5(p(v, 0.2 + i * 0.13, 0.75 + i * 0.13)), 44, 1.15, 12);
    line(c, [["言葉で", BRAND], ["書くだけ。", INK]], 960 + 30, 730, TF, 10, (i) => eo5(p(v, 1.58 + i * 0.12, 2.13 + i * 0.12)), 44, 1.15, 12);
    const ru = eo5(p(v, 2.6, 3.3)); if (ru > 0) { const g = c.createLinearGradient(960 - 300 * ru, 0, 960 + 300 * ru, 0); g.addColorStop(0, "rgba(36,91,68,0)"); g.addColorStop(0.5, `rgba(36,91,68,${0.55 * ru})`); g.addColorStop(1, "rgba(36,91,68,0)"); c.fillStyle = g; c.fillRect(960 - 300 * ru, 800, 600 * ru, 2); }
    const sb = eo(p(v, 2.85, 3.45)); A(c, sb, () => T(c, "Just describe who it’s for.", 960, 872 + lerp(16, 0, sb), `italic 38px ${GEO}`, "#6f8a7b", { align: "center", ls: 0.7 }));
    const d = eo(p(v, 3.9, 4.5)); A(c, d, () => T(c, "閲覧の文脈から届ける、Webパーソナライズ基盤", 960, 950, `600 23px ${SANS}`, BRAND, { align: "center", ls: 23 * lerp(0.5, 0.28, d) }));
    ctx.save(); ctx.beginPath(); ctx.arc(960, 540, eio(p(v, 0, 0.6)) * 1250, 0, 6.283); ctx.clip(); ctx.drawImage(layer, 0, 0); ctx.restore();
    const ring = p(v, 0, 0.6); if (ring < 1) { ctx.save(); ctx.strokeStyle = `rgba(200,216,106,${1 - ring})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(960, 540, eio(ring) * 1250, 0, 6.283); ctx.stroke(); ctx.restore(); }
  }

  return function render(ctx, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none";
    drawBg(ctx, t); s1(ctx, t); s2(ctx, t); s3(ctx, t); s4(ctx, t); s5(ctx, t);
    const vg = ctx.createRadialGradient(960, 540, 620, 960, 540, 1150); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.42)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    s6(ctx, t);
  };
}
