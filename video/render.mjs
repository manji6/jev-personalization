// scene.mjs を1フレームずつ描いて ffmpeg へ渡し、MP4にする（ブラウザ不要）。
// 使い方: CANVAS_DIR=<@napi-rs/canvas を入れたディレクトリ> node video/render.mjs out.mp4 [audio.wav]
//   STILLS=1.0,4.6 を付けると、その時刻の静止画だけを書き出す。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
// SCENE=scene30.mjs で30秒版を選ぶ（既定は10秒のティザー）
const { makeScene, W, H, DUR } = await import("./" + (process.env.SCENE ?? "scene.mjs"));
const out = path.resolve(process.argv[2] ?? path.join(here, "out/jevsense.mp4"));
const audio = process.argv[3] ? path.resolve(process.argv[3]) : null;
const FPS = Number(process.env.FPS ?? 60);
const require = createRequire(path.join(process.env.CANVAS_DIR ?? here, "package.json"));
const { createCanvas } = require("@napi-rs/canvas");

const canvas = createCanvas(W, H), ctx = canvas.getContext("2d");
const render = makeScene(createCanvas);
fs.mkdirSync(path.dirname(out), { recursive: true });

if (process.env.STILLS) {
  for (const s of process.env.STILLS.split(",")) {
    render(ctx, Number(s));
    fs.writeFileSync(path.join(path.dirname(out), `still-${s}.jpg`), canvas.toBuffer("image/jpeg", 82));
  }
  process.exit(0);
}

const args = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-framerate", String(FPS), "-i", "-"];
if (audio) args.push("-i", audio);
args.push("-vf", "scale=out_color_matrix=bt709:out_range=tv", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart");
if (audio) args.push("-c:a", "aac", "-b:a", "256k", "-shortest");
args.push(out);
const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res, rej) => ff.on("close", (c) => (c ? rej(new Error("ffmpeg exit " + c)) : res())));

const total = Math.round(DUR * FPS);
for (let f = 0; f < total; f++) {
  render(ctx, f / FPS);
  if (!ff.stdin.write(canvas.data())) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 120 === 0) console.log(`frame ${f}/${total}`);
}
ff.stdin.end();
await done;
console.log("wrote", out);
