<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const examples = [
  "吸汗速乾機能のあるポロシャツに関心がある人",
  "はじめての住宅ローンを比較している人",
  "法人向けプランの料金を調べている人",
];
const question = "どんな人に届けたいですか？";

const text = ref(examples[0]);
const asking = ref(false);
const done = ref(true);
let alive = true;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

onMounted(async () => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let k = 0;
  await wait(2600);
  while (alive) {
    k = (k + 1) % examples.length;
    done.value = false;
    asking.value = true;
    text.value = question;
    await wait(1700);
    asking.value = false;
    text.value = "";
    for (const ch of examples[k]) {
      if (!alive) return;
      text.value += ch;
      await wait(70 + Math.random() * 60);
    }
    await wait(450);
    done.value = true;
    await wait(3200);
  }
});
onBeforeUnmount(() => {
  alive = false;
});
</script>

<template>
  <div class="hero-ask" role="img" aria-label="入力欄に「吸汗速乾機能のあるポロシャツに関心がある人」と書くと、届ける相手が決まる様子">
    <div class="field" aria-hidden="true">
      <span :class="{ ph: asking }">{{ text }}</span
      ><span class="caret" />
    </div>
    <div class="done" :class="{ off: !done }" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="10" fill="currentColor" />
        <path
          d="M5.5 10.4l3 3 6-6.6"
          fill="none"
          stroke="var(--vp-c-bg)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>これで、届ける相手が決まりました。</span>
    </div>
  </div>
</template>

<style scoped>
.hero-ask {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  border: 1.5px solid var(--vp-c-brand-1);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  padding: 18px 20px;
  min-height: 5.6em;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.7;
  color: var(--vp-c-text-1);
}
.ph {
  color: var(--vp-c-text-2);
  font-weight: 400;
}
.caret {
  display: inline-block;
  width: 2px;
  height: 1.15em;
  background: var(--vp-c-brand-1);
  vertical-align: -0.2em;
  margin-left: 2px;
  animation: blink 1s steps(1) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.done {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--vp-c-brand-1);
  font-weight: 700;
  font-size: 15px;
  transition:
    opacity 0.4s,
    transform 0.4s;
}
.done.off {
  opacity: 0;
  transform: translateY(4px);
}
@media (prefers-reduced-motion: reduce) {
  .caret {
    animation: none;
  }
  .done {
    transition: none;
  }
}
</style>
