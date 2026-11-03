<script setup lang="ts">
import { computed, ref } from 'vue'
import { DEMO, DEMO_KINDS, QUIZ_CORRECT, demoAnswer, demoRows, type DemoKind } from '../../landing/demo'

const kind = ref<DemoKind>('poll')
const selected = ref<number | null>(null)
const open = ref(true)
const shown = ref(true)
const revealed = ref(false)
const rows = computed(() => demoRows(kind.value, selected.value))
const sample = computed(() => DEMO[kind.value])
const total = computed(() => rows.value.reduce((sum, row) => sum + row.count, 0))
const message = computed(() => {
  if (kind.value === 'quiz' && revealed.value) return selected.value === null ? 'Answer revealed: Mercury.' : selected.value === QUIZ_CORRECT ? 'Correct! Mercury is closest to the Sun.' : 'The correct answer is Mercury. Try again with Reset demo.'
  if (!open.value) return 'Voting is closed in this demo.'
  if (selected.value !== null) return kind.value === 'quiz' ? 'Answer saved. Change it until the answer is revealed.' : 'Your answer is on the stage. Try another option.'
  return kind.value === 'word-cloud' ? 'Tap a word to grow it on the stage.' : 'Tap an answer on the phone.'
})
function reset(next: DemoKind = kind.value) {
  kind.value = next; selected.value = null; open.value = true; shown.value = true; revealed.value = false
}
function answer(index: number) {
  selected.value = demoAnswer(kind.value, selected.value, index, open.value, revealed.value)
}
</script>

<template>
  <section class="preview" aria-label="Interactive product demo" data-ui>
    <div class="demo-heading"><b>Try a demo</b><button type="button" class="reset" @click="reset()">Reset demo</button></div>
    <p class="demo-note">Sample answers only. No live room or account.</p>
    <div class="switcher" role="group" aria-label="Demo question type">
      <button v-for="item in DEMO_KINDS" :key="item.id" type="button" :aria-pressed="kind === item.id" @click="reset(item.id)">{{ item.label }}</button>
    </div>
    <div class="paired">
      <section class="stage" aria-label="Demo stage">
        <p class="surface-label">On the big screen <span>{{ total }} sample answers</span></p>
        <h2>{{ sample.question }}</h2>
        <div class="results">
          <p v-if="!shown" class="waiting">Results hidden. The audience can still answer.</p>
          <div v-else-if="kind === 'word-cloud'" class="cloud" aria-label="Sample word cloud">
            <span v-for="(row, i) in rows" :key="row.label" :class="`tone-${i}`" :style="{ fontSize: `${1 + row.count * 0.18}rem` }">{{ row.label }}<small>{{ row.count }}</small></span>
          </div>
          <template v-else>
            <div v-for="(row, i) in rows" :key="row.label" class="bar">
              <div class="bar-label"><span>{{ row.label }}<b v-if="kind === 'quiz' && revealed && i === QUIZ_CORRECT"> · Correct</b></span><span>{{ row.count }} · {{ row.percent }}%</span></div>
              <div class="track"><div class="fill" :class="`tone-${i}`" :style="{ width: row.percent + '%' }"></div></div>
            </div>
          </template>
        </div>
        <div class="demo-controls" aria-label="Demo presenter controls">
          <button v-if="kind === 'quiz'" type="button" :disabled="revealed" @click="revealed = true; open = false; shown = true">{{ revealed ? 'Answer revealed' : 'Reveal answer' }}</button>
          <button v-else type="button" :aria-pressed="!open" @click="open = !open">{{ open ? 'Close voting' : 'Open voting' }}</button>
          <button type="button" :aria-pressed="!shown" @click="shown = !shown">{{ shown ? 'Hide results' : 'Show results' }}</button>
        </div>
      </section>
      <section class="phone" aria-label="Demo audience phone">
        <p class="surface-label"><img src="../../assets/logo-mark.svg" alt="" /> On your phone</p>
        <p class="pq">{{ sample.question }}</p>
        <button v-for="(row, i) in rows" :key="row.label" type="button" class="opt" :class="{ sel: selected === i }" :aria-pressed="selected === i" :disabled="!open || (kind === 'quiz' && revealed)" @click="answer(i)"><span aria-hidden="true">{{ selected === i ? '●' : '○' }}</span>{{ row.label }}</button>
      </section>
    </div>
    <p class="feedback" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.preview { min-width: 0; }
.demo-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.demo-heading b { font-size: var(--fs-lg); }
.reset { padding: var(--space-2); border: 0; background: none; color: var(--lead); font: inherit; font-size: var(--fs-sm); cursor: pointer; }
.demo-note { margin: var(--space-1) 0 var(--space-4); color: var(--ink-2); font-size: var(--fs-sm); }
.switcher { display: flex; gap: var(--space-1); margin-bottom: var(--space-4); padding: var(--space-1); background: var(--line); border-radius: var(--radius-lg); }
.switcher button { flex: 1; border: 0; border-radius: var(--radius-sm); padding: var(--space-3) var(--space-2); background: transparent; color: var(--ink-2); font: inherit; font-size: var(--fs-sm); font-weight: 700; cursor: pointer; }
.switcher button[aria-pressed='true'] { background: var(--card); color: var(--ink); box-shadow: var(--shadow); }
.paired { display: grid; grid-template-columns: minmax(0, 1fr) 176px; align-items: start; gap: var(--space-3); }
.stage { min-width: 0; background: var(--inverse); color: var(--inverse-ink); padding: var(--space-5); border-radius: var(--radius); box-shadow: var(--shadow); }
.surface-label { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-4); font-size: var(--fs-xs); font-weight: 600; }
.stage .surface-label { color: var(--inverse-muted); }
.surface-label span { font-weight: 400; }
.stage h2 { font-size: var(--fs-lg); line-height: 1.4; margin: 0 0 var(--space-5); }
.results { min-height: 150px; }
.bar { margin-bottom: var(--space-4); }
.bar-label { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-1); margin-bottom: var(--space-2); font-size: var(--fs-xs); }
.bar-label > span:last-child { font-variant-numeric: tabular-nums; color: var(--inverse-muted); white-space: nowrap; }
.track { height: 12px; border-radius: var(--radius-pill); overflow: hidden; background: var(--inverse-line); }
.fill { height: 100%; border-radius: inherit; transition: width var(--dur-bars) var(--ease); }
.tone-0 { background: var(--lead); }.tone-1 { background: var(--signal); }.tone-2 { background: var(--warmth); }
.cloud { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-3); padding: var(--space-4) 0; }
.cloud span { background: none; font-weight: 800; }.cloud .tone-0 { color: var(--inverse-ink); }.cloud .tone-1 { color: var(--inverse-muted); }.cloud .tone-2 { color: var(--warmth); }
.cloud small { display: inline-block; margin-left: var(--space-1); font-size: var(--fs-xs); }
.waiting { font-size: var(--fs-base); line-height: 1.6; color: var(--inverse-muted); }
.demo-controls { display: flex; flex-wrap: wrap; gap: var(--space-2); border-top: 1px solid var(--inverse-line); padding-top: var(--space-4); }
.demo-controls button { min-height: 44px; border: 1px solid var(--inverse-line); border-radius: var(--radius-sm); background: transparent; color: var(--inverse-ink); font: inherit; font-size: var(--fs-xs); padding: var(--space-2); cursor: pointer; }
.phone { padding: var(--space-4) var(--space-3); border: 3px solid var(--line); border-radius: 24px; background: var(--card); box-shadow: var(--shadow); }
.phone img { width: 18px; height: 18px; }.phone .surface-label { color: var(--ink-2); }
.pq { margin: 0 0 var(--space-4); font-size: var(--fs-sm); font-weight: 800; line-height: 1.4; }
.opt { display: flex; width: 100%; text-align: left; align-items: center; gap: var(--space-2); min-height: 44px; margin-bottom: var(--space-2); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--paper); color: var(--ink); font: inherit; font-size: var(--fs-xs); cursor: pointer; }
.opt.sel { border-color: var(--lead); background: var(--lead-soft); }.opt span { color: var(--lead); }
button:disabled { cursor: default; opacity: 0.65; }button:focus-visible { outline: 3px solid var(--lead); outline-offset: 3px; }
.feedback { min-height: 2.8em; margin: var(--space-3) 0 0; color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.4; }
@media (max-width: 1080px) and (min-width: 901px) { .paired { grid-template-columns: 1fr; }.phone { border-radius: var(--radius); }.phone .opt { display: inline-flex; width: auto; margin-right: var(--space-2); } }
@media (max-width: 440px) { .paired { grid-template-columns: minmax(0, 1fr) 144px; gap: var(--space-2); }.stage { padding: var(--space-4) var(--space-3); }.stage h2 { font-size: var(--fs-base); }.phone { padding: var(--space-4) var(--space-2); }.phone .surface-label { gap: var(--space-1); font-size: 0.72rem; }.bar-label { font-size: 0.72rem; }.stage .surface-label span { display: block; }.demo-controls { gap: var(--space-1); }.demo-controls button { font-size: 0.72rem; }.results { min-height: 180px; } }
@media (max-width: 359px) { .paired { grid-template-columns: 1fr; }.results { min-height: 150px; }.phone { border-radius: var(--radius); }.stage h2 { font-size: var(--fs-md); } }
@media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
</style>
