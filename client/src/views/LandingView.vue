<script setup lang="ts">
import { computed } from 'vue'
import { readableOn } from '../themes'
import { useAuthStore } from '../stores/auth'
import { STEPS, QUESTION_TYPES } from '../landing/content'
import JoinWithCode from '../components/landing/JoinWithCode.vue'
import SamplePreview from '../components/landing/SamplePreview.vue'
import { vReveal } from '../landing/reveal'

const auth = useAuthStore()
// Signed-in presenters go straight to their dashboard.
const createTarget = computed(() => (auth.isLoggedIn ? { name: 'dashboard' } : { name: 'signup' }))
</script>

<template>
  <div class="landing">
    <section class="hero-grid">
      <div class="copy">
        <p class="eyebrow">Interactive presentations for any room</p>
        <h1>Ask the room. <em>See it respond.</em></h1>
        <p class="lead">
          Build interactive slides. Share a code. Let everyone answer from their phones.
        </p>
        <div class="cta">
          <RouterLink class="button big block" :to="createTarget">Create a presentation</RouterLink>
          <div><JoinWithCode /></div>
        </div>
      </div>
      <SamplePreview class="visual" />
    </section>

    <section v-reveal class="band product-proof" aria-labelledby="features-title">
      <h2 id="features-title">Your slides. Your pace.</h2>
      <p class="band-lead">Build beside a stage preview, then decide what the room sees.</p>
      <figure>
        <a href="/landing/editor.webp" target="_blank" rel="noopener" aria-label="View full editor screenshot (opens in a new tab)"><picture><source media="(max-width: 560px)" srcset="/landing/editor-detail.webp" /><img src="/landing/editor.webp" alt="CrowdFlow editor: question and answer fields, with the full slide list and stage preview on larger screens" loading="lazy" width="1280" height="800" /></picture><span class="image-link">View full editor ↗</span></a>
        <figcaption><b>Build your presentation</b> Add question and content slides, choose a theme, and see your changes beside the editor.</figcaption>
      </figure>
      <figure>
        <a href="/landing/presenter.webp" target="_blank" rel="noopener" aria-label="View full presenter screen (opens in a new tab)"><img src="/landing/presenter.webp" alt="CrowdFlow presenter screen showing poll results, the join code, slide navigation, voting and result visibility controls" loading="lazy" width="1280" height="800" /><span class="image-link">View full presenter screen ↗</span></a>
        <figcaption><b>Keep the room with you</b> Move through slides, close voting or hide results while people think.</figcaption>
      </figure>
      <p class="capture-note">Actual app screens with a local sample presentation. Tap either image to open it at full size.</p>
    </section>

    <section v-reveal class="band" aria-labelledby="steps-title">
      <h2 id="steps-title">Build. Share. Present.</h2>
      <p class="band-lead">No installs or accounts for the audience. Nicknames for quizzes only.</p>
      <ol class="steps">
        <li v-for="(step, i) in STEPS" :key="step.title"><span class="num" aria-hidden="true">{{ i + 1 }}</span><span><b>{{ step.title }}</b><span>{{ step.text }}</span></span></li>
      </ol>
      <h3 id="types-title">Six ways to ask, in one presentation</h3>
      <ul class="types" aria-labelledby="types-title">
        <li v-for="t in QUESTION_TYPES" :key="t.name"><span class="tile" :style="{ background: t.color, color: readableOn(t.color) }" aria-hidden="true">{{ t.glyph }}</span><span>{{ t.name }}</span></li>
      </ul>
    </section>

    <section v-reveal class="final">
      <h2>Ready to ask your first question?</h2>
      <p>Create a presentation, or join one with a code.</p>
      <div class="final-actions">
        <RouterLink class="button big" :to="createTarget">Create a presentation</RouterLink>
        <RouterLink class="button big ghost-light" :to="{ name: 'join' }">Join with a code</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing { max-width: 1120px; margin: 0 auto; padding: 0 var(--space-5) var(--space-7); }
.hero-grid { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: var(--space-6); align-items: center; padding: 48px 0; }
.eyebrow { margin: 0 0 14px; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--lead); }
h1 { margin: 0 0 18px; font-size: clamp(2.3rem, 5vw, 3.4rem); line-height: 1.05; letter-spacing: -0.03em; font-weight: 800; }
h1 em {
  font-style: normal; color: var(--lead);
  background: linear-gradient(90deg, var(--lead), var(--signal)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.lead { max-width: 520px; margin: 0 0 28px; font-size: var(--fs-lg); line-height: 1.55; color: var(--ink-2); }
.cta { display: flex; flex-direction: column; gap: 14px; max-width: 460px; }
.band { padding: 56px 0; border-top: 1px solid var(--line); }
.band h2 { margin: 0 0 var(--space-2); font-size: clamp(1.6rem, 3vw, 2rem); letter-spacing: -0.02em; }
.band-lead { max-width: 560px; margin: 0 0 var(--space-6); font-size: var(--fs-md); line-height: 1.5; color: var(--ink-2); }
.num {
  display: grid; place-items: center; width: 34px; height: 34px; margin-bottom: 14px;
  border-radius: var(--radius-md); background: var(--lead-soft); color: var(--lead); font-weight: 800;
}
.tile { display: grid; place-items: center; flex-shrink: 0; width: 38px; height: 38px; border-radius: 11px; color: var(--on-accent); font-weight: 800; }
.product-proof a { color: var(--lead); text-decoration: none; }
.image-link { display: block; margin-top: var(--space-2); font-size: var(--fs-sm); font-weight: 700; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-5); list-style: none; padding: 0; margin: 0 0 var(--space-6); }
.steps li { display: flex; align-items: start; gap: var(--space-3); }
.steps b, .steps li > span > span { display: block; }
.steps li > span > span { font-size: var(--fs-sm); color: var(--ink-2); line-height: 1.5; margin-top: var(--space-1); }
.num { flex: none; }
.types { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); list-style: none; padding: 0; margin: var(--space-4) 0 0; }
.types li { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-sm); }
.types .tile { width: 28px; height: 28px; border-radius: var(--radius-sm); }
.product-proof figure { margin: 0 0 var(--space-6); }
.product-proof img { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.product-proof figcaption { margin-top: var(--space-3); max-width: 700px; color: var(--ink-2); font-size: var(--fs-base); line-height: 1.6; }
.product-proof figcaption b { display: block; color: var(--ink); font-size: var(--fs-md); }
.capture-note { color: var(--ink-2); font-size: var(--fs-sm); }
.final {
  margin: var(--space-2) 0 var(--space-5); padding: var(--space-7) var(--space-6); text-align: center;
  background: var(--inverse); color: var(--inverse-ink); border-radius: 24px;
}
.final h2 { margin: 0 0 var(--space-2); font-size: clamp(1.5rem, 3vw, 2rem); }
.final p { margin: 0 0 var(--space-5); color: var(--inverse-muted); }
.final-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-3); }
.ghost-light { background: transparent; color: var(--inverse-ink); border: 1px solid var(--inverse-line); }
.ghost-light:hover { background: rgb(255 255 255 / 0.08); }

/* Hero entrance: headline, subtext, buttons, then the preview. Never delays content
   for reduced-motion users (guarded below). */
.copy > *, .visual { animation: hero-rise 520ms var(--ease) both; }
.copy > *:nth-child(2) { animation-delay: 70ms; }
.copy > *:nth-child(3) { animation-delay: 140ms; }
.copy > *:nth-child(4) { animation-delay: 210ms; }
.visual { animation-delay: 260ms; }
@keyframes hero-rise {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
}

/* Keep section entrances short and respect reduced motion. */
.reveal > h2, .reveal > .band-lead, .reveal.final > * { opacity: 0; transform: translateY(16px); transition: opacity 420ms var(--ease), transform 420ms var(--ease); }
.reveal.revealed > h2, .reveal.revealed > .band-lead, .reveal.revealed.final > * { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .copy > *, .visual { animation: none; }
  .reveal > h2, .reveal > .band-lead, .reveal.final > * { opacity: 1; transform: none; transition: none; }
}

@media (max-width: 900px) {
  .landing { padding: 0 20px var(--space-6); }
  .hero-grid { grid-template-columns: 1fr; gap: var(--space-5); padding: 24px 0 32px; }
  h1 { font-size: 2.2rem; }
  .eyebrow { margin-bottom: var(--space-2); font-size: 0.72rem; letter-spacing: 0.02em; }
  .lead { margin-bottom: var(--space-4); }
  .lead { font-size: 1.02rem; }
  .cta { max-width: none; }
  .band { padding: var(--space-6) 0; }
  .steps { grid-template-columns: 1fr; gap: var(--space-4); }
  .final { padding: 36px 20px; }
}
@media (max-width: 560px) { .product-proof picture img { aspect-ratio: 580 / 370; object-fit: cover; } }
</style>
