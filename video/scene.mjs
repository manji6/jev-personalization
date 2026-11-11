// JevSense ティザー（10秒）の絵コンテ。時刻 t を渡すと1フレームを描く。
// 0.0–2.5 コピー / 2.5–5.0 察知→判定 / 5.0–7.5 条件→表示 / 7.5–10 ロゴ
export const W = 1920, H = 1080, DUR = 10;

const SANS = '"Hiragino Sans"', MIN = '"Hiragino Mincho ProN"', LAT = '"Avenir Next"', GEO = "Georgia";
const CREAM = "#f4f5f0", MINT = "#9ecfaf", MINT2 = "#c9ecd5", LIME = "#c8d86a", JEV = "#b9a8f0", URLC = "#9cc4ee", ORC = "#e8c98c";
const DIM = "rgba(220,238,226,.62)";

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
  // 文字ごとの配置（segs: [[text, color], ...]）
  function layout(c, segs, font, ls) {
    c.save(); c.font = font; c.letterSpacing = "0px"; let x = 0; const out = [];
    for (const [s, col] of segs) for (const ch of s) { const w = c.measureText(ch).width; out.push({ ch, x, w, col }); x += w + ls; }
    c.restore(); return { g: out, width: x - ls };
  }
  // k: 0→1 で1文字が現れる
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
  function step(c, x, y, no, label, a, dx) {
    if (a <= 0) return; c.save(); c.globalAlpha *= a; c.translate(dx, 0);
    T(c, no, x, y, `600 22px ${LAT}`, MINT, { ls: 6 });
    c.fillStyle = "rgba(158,207,175,.6)"; c.fillRect(x + 56, y - 9, 44, 1.5);
    T(c, label, x + 118, y + 2, `700 28px ${SANS}`, CREAM, { ls: 6 }); c.restore();
  }
  function star(c, x, y, r, fill) { c.fillStyle = fill; c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 - Math.PI / 2, q = i % 2 ? r * 0.36 : r; c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } c.closePath(); c.fill(); }
  // ロゴマーク（favicon.svg と同じ比率）
  function mark(c, cx, cy, size, k, rot, c0, c1, glow) {
    if (k <= 0) return; c.save(); c.translate(cx, cy); c.rotate(rot); c.scale(k, k);
    const g = c.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2); g.addColorStop(0, c0); g.addColorStop(1, c1);
    c.save(); c.shadowColor = glow; c.shadowBlur = size * 0.55; c.shadowOffsetY = size * 0.08; c.fillStyle = g; rr(c, -size / 2, -size / 2, size, size, size * 0.267); c.fill(); c.restore();
    c.strokeStyle = "rgba(210,240,222,.35)"; c.lineWidth = 1.5; rr(c, -size / 2, -size / 2, size, size, size * 0.267); c.stroke();
    T(c, "j.", -size / 2 + size * 0.317, -size / 2 + size * 0.733, `italic ${size * 0.75}px ${GEO}`, "#fff"); c.restore();
  }
  function comp(ctx, o = {}) {
    const { a = 1, s = 1, tx = 0, blur = 0 } = o; if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a; if (blur > 0.3) ctx.filter = `blur(${blur}px)`;
    ctx.translate(W / 2 + tx, H / 2); ctx.scale(s, s); ctx.drawImage(layer, -W / 2, -H / 2); ctx.restore();
  }
  const begin = () => { lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalAlpha = 1; lc.filter = "none"; lc.clearRect(0, 0, W, H); return lc; };
  const A = (c, a, fn) => { if (a <= 0) return; c.save(); c.globalAlpha *= clamp(a); fn(); c.restore(); };

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

  // ---------- Scene 1 ----------
  const trail = [[[-60, 760], [300, 560], [420, 980], [760, 880]], [[760, 880], [1100, 780], [1180, 180], [1500, 230]], [[1500, 230], [1760, 270], [1820, 560], [2000, 470]]];
  function scene1(ctx, t) {
    if (t >= 2.55) return; const c = begin();
    const prog = eio(p(t, 0.05, 2.3)) * 3;
    trail.forEach((P, i) => {
      const s1 = clamp(prog - i); strokeBez(c, P, 0, s1, "rgba(158,207,175,.3)", 2);
      if (s1 > 0 && i > 0) { const [x, y] = P[0]; c.strokeStyle = "rgba(201,236,213,.7)"; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9 + 5 * eo(p(prog - i, 0, 0.5)), 0, 6.283); c.stroke(); glowDot(c, x, y, 3.5, "158,230,185", 0.9); }
    });
    if (prog < 3) { const i = Math.min(2, Math.floor(prog)); const [x, y] = bez(...trail[i], prog - i); glowDot(c, x, y, 6, "170,240,195", 1); }
    const k = eo(p(t, 0.1, 0.7));
    A(c, k * 0.9, () => T(c, "WEB PERSONALIZATION", 960, 292 + lerp(14, 0, k), `600 22px ${LAT}`, MINT, { align: "center", ls: 22 * lerp(1.1, 0.62, eo5(p(t, 0.1, 1.3))) }));
    const F = `600 172px ${MIN}`, kk = (i0) => (i) => eo5(p(t, 0.28 + (i + i0) * 0.115 + (i0 ? 0.18 : 0), 0.9 + (i + i0) * 0.115 + (i0 ? 0.18 : 0)));
    line(c, [["その人の、", CREAM]], 960 + 30, 520, F, 8, kk(0), 70, 1.25, 16);
    line(c, [["い", CREAM], ["まを", MINT2], ["。", CREAM]], 960 + 30, 734, F, 8, kk(5), 70, 1.25, 16);
    const r = eo5(p(t, 1.45, 2.1));
    if (r > 0) { const g = c.createLinearGradient(960 - 260 * r, 0, 960 + 260 * r, 0); g.addColorStop(0, "rgba(158,207,175,0)"); g.addColorStop(0.5, `rgba(158,207,175,${r})`); g.addColorStop(1, "rgba(158,207,175,0)"); c.fillStyle = g; c.fillRect(960 - 260 * r, 808, 520 * r, 2); }
    const out = ei(p(t, 2.12, 2.5));
    comp(ctx, { a: 1 - out, s: 1 + 0.16 * out + 0.035 * p(t, 0, 2.5), blur: out * 18 });
  }

  // ---------- Scene 2 ----------
  const pages = [["ランニング入門ガイド", "記事", 42], ["吸汗速乾ポロシャツ", "商品", 78], ["通勤ランニングシューズ", "商品", 36]];
  const flows = [300, 450, 600].map((y) => [[570, y + 60], [740, y + 60], [730, 510], [876, 510]]);
  const outFlow = [[1044, 510], [1120, 510], [1210, 510], [1290, 510]];
  function caption(c, segs, k) {
    if (k <= 0) return; c.save(); c.globalAlpha *= k; const b = (1 - k) * 10; if (b > 0.3) c.filter = `blur(${b}px)`;
    const F = `600 62px ${MIN}`; line(c, segs, 960 + 14, 950 + (1 - k) * 30, F, 5, () => 1, 0); c.restore();
  }
  function scene2(ctx, t) {
    if (t < 2.45 || t >= 5.05) return; const c = begin(), w = t - 2.5;
    flows.forEach((P, i) => {
      const s1 = eo(p(w, 0.35 + i * 0.12, 0.95 + i * 0.12)); strokeBez(c, P, 0, s1, "rgba(158,207,175,.38)", 2);
      if (w > 0.5) for (let k = 0; k < 4; k++) { const s = ((w - 0.5) * 0.95 + k / 4 + i * 0.13) % 1; if (s > s1) continue; const [x, y] = bez(...P, s); glowDot(c, x, y, 4, "170,240,195", Math.sqrt(Math.sin(s * Math.PI))); }
    });
    strokeBez(c, outFlow, 0, eo(p(w, 0.95, 1.3)), "rgba(185,168,240,.6)", 2.5);
    if (w > 1.1) for (let k = 0; k < 3; k++) { const s = ((w - 1.1) * 1.5 + k / 3) % 1; const [x, y] = bez(...outFlow, s); glowDot(c, x, y, 4, "200,185,255", Math.sqrt(Math.sin(s * Math.PI))); }

    step(c, 140, 262, "01", "察知", eo(p(w, 0, 0.4)), lerp(-30, 0, eo(p(w, 0, 0.4))));
    pages.forEach(([title, kind, sec], i) => {
      const a = 0.06 + i * 0.16, k = eo5(p(w, a, a + 0.55)), y = 300 + i * 150;
      A(c, k, () => {
        c.translate(lerp(-120, 0, k), 0); glass(c, 140, y, 430, 120, 22);
        c.fillStyle = "rgba(158,207,175,.14)"; rr(c, 166, y + 33, 54, 54, 16); c.fill(); c.strokeStyle = "rgba(158,207,175,.45)"; c.lineWidth = 1.2; c.stroke();
        T(c, String(i + 1), 193, y + 69, `600 24px ${LAT}`, MINT2, { align: "center" });
        T(c, title, 244, y + 56, `600 27px ${SANS}`, CREAM, { ls: 0.5 });
        T(c, `${kind} ・ 閲覧 ${Math.round(sec * eo(p(w, a + 0.1, a + 0.9)))}秒`, 244, y + 92, `400 19px ${SANS}`, DIM, { ls: 0.8 });
      });
    });
    [0, 0.5].forEach((d) => { if (w <= 0.6) return; const q = ((w - 0.6) * 1.1 + d) % 1; c.strokeStyle = `rgba(158,207,175,${(1 - q) * 0.7})`; c.lineWidth = 1.5; c.beginPath(); c.arc(960, 510, 80 * (1 + q * 1.9), 0, 6.283); c.stroke(); });
    const o = p(w, 0.25, 0.75);
    A(c, o * 3, () => mark(c, 960, 510, 160, lerp(0.3, 1, back(o)) * (1 + 0.035 * Math.sin(w * 9)), 0, "#317a5b", "#1b4735", "rgba(90,210,145,.75)"));

    step(c, 1290, 280, "02", "判定", eo(p(w, 0.7, 1.1)), lerp(30, 0, eo(p(w, 0.7, 1.1))));
    const q = eo5(p(w, 0.75, 1.3)), v = 0.86 * eo(p(w, 1.2, 1.95)), fl = p(w, 2.0, 2.6);
    A(c, q, () => {
      c.translate(lerp(110, 0, q), 0);
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
      const y = p(w, 2.0, 2.3);
      A(c, y * 4, () => { c.translate(1736, 314); c.rotate(0.105); const s = lerp(2.4, 1, eo5(y)); c.scale(s, s); c.save(); c.shadowColor = "rgba(200,216,106,.8)"; c.shadowBlur = 70; c.fillStyle = LIME; rr(c, -88, -39, 176, 78, 16); c.fill(); c.restore(); T(c, "YES", 0, 18, `700 50px ${LAT}`, "#1a2408", { align: "center", ls: 5 }); });
    });
    caption(c, [["閲覧の文脈を", CREAM], ["察知", LIME], ["し、", CREAM], ["判定", LIME], ["する。", CREAM]], eo(p(w, 0.35, 0.9)));
    const out = ei(p(t, 4.8, 5.02));
    comp(ctx, { a: eo(p(t, 2.45, 2.8)) * (1 - out), s: 1 + 0.02 * p(w, 0, 2.5), tx: -90 * out, blur: out * 10 });
  }

  // ---------- Scene 3 ----------
  const E = { e1: [[235, 372], [235, 440], [330, 420], [345, 478]], e2: [[515, 372], [515, 440], [420, 420], [405, 478]], e3: [[375, 588], [375, 620], [375, 646], [375, 676]], e4: [[535, 742], [660, 742], [680, 690], [800, 690]] };
  function node(c, x, y, w, h, col, rgb, title, body, k, lit, dim, hasStar, val) {
    if (k <= 0) return; c.save(); c.globalAlpha *= clamp(k * 3) * (1 - dim * 0.55);
    c.translate(x + w / 2, y + h / 2); const s = lerp(0.6, 1, back(k)); c.scale(s, s); c.translate(-w / 2, -h / 2);
    c.save(); c.shadowColor = lit > 0 ? `rgba(${rgb},${0.6 * lit})` : "rgba(0,0,0,.45)"; c.shadowBlur = lit > 0 ? 55 : 50; c.shadowOffsetY = lit > 0 ? 0 : 22; c.fillStyle = "rgb(14,34,26)"; rr(c, 0, 0, w, h, 18); c.fill(); c.restore();
    c.save(); rr(c, 0, 0, w, h, 18); c.clip(); c.fillStyle = col; c.fillRect(0, 0, w, 44); c.restore();
    if (hasStar) star(c, 28, 22, 8, "#10201a");
    T(c, title, hasStar ? 44 : 18, 29, `700 19px ${SANS}`, "#10201a", { ls: 1.2 });
    body.forEach((b, i) => T(c, b, 18, 80 + i * 31, `600 21px ${SANS}`, CREAM, { ls: 0.4 }));
    if (val) T(c, val, w - 18, 80 + (body.length - 1) * 31 + 4, `600 30px ${LAT}`, MINT2, { align: "right" });
    c.strokeStyle = `rgba(${rgb},${lerp(0.25, 1, lit)})`; c.lineWidth = lerp(1.5, 2.5, lit); rr(c, 0, 0, w, h, 18); c.stroke(); c.restore();
  }
  function scene3(ctx, t) {
    if (t < 4.95 || t >= 8.2) return; const c = begin(), u = t - 5.0;
    step(c, 110, 154, "03", "表示", eo(p(u, 0, 0.4)), 0);
    strokeBez(c, E.e1, 0, eio(p(u, 0.3, 0.6)), "rgba(190,230,205,.22)", 3);
    strokeBez(c, E.e2, 0, eio(p(u, 0.5, 0.85)), MINT, 4);
    strokeBez(c, E.e3, 0, eio(p(u, 0.85, 1.15)), MINT, 4);
    const e4 = eio(p(u, 1.15, 1.5));
    for (let i = 0; i < 16; i++) { const s = (i / 16 + u * 0.22) % 1; if (s > e4) continue; const [x, y] = bez(...E.e4, s); c.fillStyle = LIME; c.beginPath(); c.arc(x, y, 3, 0, 6.283); c.fill(); }
    const nk = (i) => p(u, 0.04 + i * 0.09, 0.46 + i * 0.09), lit = (on) => eo(p(u, on, on + 0.25));
    node(c, 110, 230, 250, 142, URLC, "156,196,238", "URL条件", ["流入コードに", "runner を含む"], nk(0), 0, p(u, 0.5, 0.8), false);
    node(c, 390, 230, 250, 142, JEV, "185,168,240", "Jev条件", ["ポロシャツに", "関心がある"], nk(1), lit(0.5), 0, true, "0.86");
    node(c, 265, 478, 220, 110, ORC, "232,201,140", "OR", ["どれかを満たす"], nk(2), lit(0.85), 0, false);
    node(c, 215, 676, 320, 132, MINT, "158,207,175", "表示対象の判定", ["条件を満たす"], nk(3), lit(1.15), 0, false);

    // 表示形式
    const fk = eo(p(u, 0.5, 0.9));
    A(c, fk, () => { let x = 800; c.translate(0, lerp(14, 0, fk)); for (const [s, on] of [["モーダル", 0], ["フローティング", 1], ["通知バー", 0], ["独自JavaScript", 0]]) { c.font = `600 18px ${SANS}`; c.letterSpacing = "1.4px"; const w = c.measureText(s).width + 36; rr(c, x, 112, w, 40, 20); if (on) { c.fillStyle = MINT; c.fill(); } else { c.strokeStyle = "rgba(190,230,205,.32)"; c.lineWidth = 1.2; c.stroke(); } T(c, s, x + 18, 139, `600 18px ${SANS}`, on ? "#0c2018" : "rgba(220,238,226,.78)", { ls: 1.4 }); x += w + 12; } });

    // ブラウザ
    const b = eo5(p(u, 0.12, 0.7));
    A(c, b, () => {
      c.translate(1305, 496 + lerp(80, 0, b)); const s = lerp(0.94, 1, b); c.scale(s, s); c.translate(-1305, -496);
      c.save(); c.shadowColor = "rgba(0,0,0,.6)"; c.shadowBlur = 110; c.shadowOffsetY = 46; c.fillStyle = "#fbfbf8"; rr(c, 800, 176, 1010, 640, 22); c.fill(); c.restore();
      c.save(); rr(c, 800, 176, 1010, 640, 22); c.clip();
      c.fillStyle = "#e9ece4"; c.fillRect(800, 176, 1010, 56);
      [0, 1, 2].forEach((i) => { c.fillStyle = "#c6cbbf"; c.beginPath(); c.arc(828.5 + i * 22, 204, 6.5, 0, 6.283); c.fill(); });
      c.fillStyle = "#fbfbf8"; rr(c, 906, 188, 880, 32, 9); c.fill(); T(c, "www.example.com/products/quick-dry-polo", 922, 210, `500 16px ${LAT}`, "#66736a", { ls: 0.3 });
      const g = c.createLinearGradient(844, 276, 1244, 716); g.addColorStop(0, "#dfe8dc"); g.addColorStop(0.55, "#b9d2c1"); g.addColorStop(1, "#8fb9a2"); c.fillStyle = g; rr(c, 844, 276, 400, 440, 16); c.fill();
      c.save(); c.translate(844, 276); c.fillStyle = "rgba(255,255,255,.75)"; c.beginPath(); [[140, 110], [176, 92]].forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.quadraticCurveTo(200, 122, 224, 92); [[260, 110], [318, 160], [286, 204], [262, 186], [262, 348], [138, 348], [138, 186], [114, 204], [82, 160]].forEach(([x, y]) => c.lineTo(x, y)); c.closePath(); c.fill();
      c.fillStyle = "rgba(36,91,68,.25)"; c.beginPath(); c.moveTo(176, 92); c.quadraticCurveTo(200, 122, 224, 92); c.lineTo(212, 150); c.lineTo(200, 128); c.lineTo(188, 150); c.closePath(); c.fill(); c.restore();
      T(c, "吸汗速乾ポロシャツ", 1290, 320, `700 34px ${SANS}`, "#1d2a23", { ls: 0.6 });
      T(c, "¥4,900", 1290, 368, `600 26px ${LAT}`, "#245b44");
      [[404, 440], [438, 400], [472, 300]].forEach(([y, w]) => { c.fillStyle = "#e3e7de"; rr(c, 1290, y, w, 18, 9); c.fill(); });
      // オファー（フローティング）
      const o = p(u, 1.5, 1.95), og = p(u, 1.5, 2.4);
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
    caption(c, [["用意したコンテンツを、", CREAM], ["ちょうどいい場面", LIME], ["で。", CREAM]], eo(p(u, 0.45, 1.0)));
    comp(ctx, { a: eo(p(t, 4.95, 5.3)), s: 1 + 0.02 * p(u, 0, 2.5), tx: lerp(90, 0, eo5(p(t, 4.95, 5.5))) });
  }

  // ---------- Scene 4 ----------
  function scene4(ctx, t) {
    const v = t - 7.5; if (v <= 0) return; const c = begin();
    c.fillStyle = CREAM; c.fillRect(0, 0, W, H);
    for (const [x, y, r, col] of [[960, 500, 900, "rgba(255,255,255,1)"], [1540, 1190, 1000, "rgba(36,91,68,.16)"], [190, -110, 800, "rgba(200,216,106,.24)"]]) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, "0)")); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    c.translate(960, 540); const z = 1 + 0.03 * p(v, 0, 2.5); c.scale(z, z); c.translate(-960, -540);
    const F = `700 176px ${LAT}`, L = layout(c, [["JevSense", "#1f3a2d"], [".", "#9aa93a"]], F, -6), total = 190 + 40 + L.width, x0 = 960 - total / 2;
    const m = p(v, 0.2, 0.75); A(c, m * 3, () => mark(c, x0 + 95, 395, 190, lerp(0.2, 1, back(m)), lerp(-0.32, 0, eo5(m)), "#2a6a4f", "#245b44", "rgba(36,91,68,.4)"));
    L.g.forEach((g, i) => glyph(c, g, x0 + 230, 456, F, eo5(p(v, 0.36 + i * 0.045, 0.86 + i * 0.045)), 60, 1, 10));
    line(c, [["その人の、いまを。ちょうどいいご案内に。", "#1f3a2d"]], 960 + 20, 640, `600 70px ${MIN}`, 7, (i) => eo5(p(v, 0.85 + i * 0.035, 1.35 + i * 0.035)), 26, 1, 8);
    const sb = eo(p(v, 1.45, 1.95)); A(c, sb, () => T(c, "A little sense. A better connection.", 960, 748 + lerp(16, 0, sb), `italic 36px ${GEO}`, "#6f8a7b", { align: "center", ls: 0.7 }));
    const d = eo(p(v, 1.65, 2.15)); A(c, d, () => T(c, "閲覧の文脈から届ける、Webパーソナライズ基盤", 960, 850, `600 24px ${SANS}`, "#245b44", { align: "center", ls: 24 * lerp(0.5, 0.28, d) }));
    ctx.save(); ctx.beginPath(); ctx.arc(960, 540, eio(p(v, 0, 0.6)) * 1250, 0, 6.283); ctx.clip(); ctx.drawImage(layer, 0, 0); ctx.restore();
    const ring = p(v, 0, 0.6); if (ring < 1) { ctx.save(); ctx.strokeStyle = `rgba(200,216,106,${1 - ring})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(960, 540, eio(ring) * 1250, 0, 6.283); ctx.stroke(); ctx.restore(); }
  }

  return function render(ctx, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none";
    drawBg(ctx, t); scene1(ctx, t); scene2(ctx, t); scene3(ctx, t);
    const vg = ctx.createRadialGradient(960, 540, 620, 960, 540, 1150); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.42)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    scene4(ctx, t);
  };
}
