<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLiveStore } from '../../stores/live'
import { joinPresentation } from '../../live/joinPresentation'

const router = useRouter()
const code = ref('')
const error = ref('')
const busy = ref(false)
const live = useLiveStore()

function onInput(event: Event) {
  const input = event.target as HTMLInputElement
  code.value = input.value.replace(/\D/g, '').slice(0, 6)
  input.value = code.value
  error.value = ''
}

async function submit() {
  if (busy.value) return
  error.value = ''
  if (code.value.length !== 6) {
    error.value = 'Enter the 6-digit code from your presenter.'
    return
  }
  busy.value = true
  try {
    await joinPresentation(live, code.value)
    await router.push({ name: 'audience', params: { code: code.value } })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not join. Check the code and try again.'
  } finally { busy.value = false }
}
</script>

<template>
  <form class="join" novalidate @submit.prevent="submit">
    <label class="join-label" for="landing-code">Enter your 6-digit code</label>
    <div class="join-row">
      <input
        id="landing-code"
        class="code"
        inputmode="numeric"
        autocomplete="off"
        maxlength="6"
        placeholder="123456"
        :value="code"
        :disabled="busy"
        :aria-invalid="error ? 'true' : 'false'"
        :aria-describedby="error ? 'landing-code-error' : undefined"
        @input="onInput"
      />
      <button class="button secondary-outline" type="submit" :disabled="busy"><span v-if="busy" class="spinner" aria-hidden="true"></span>{{ busy ? 'Joining…' : 'Join with a code' }}</button>
    </div>
  </form>
  <p v-if="error" id="landing-code-error" class="error-banner" role="alert">{{ error }}</p>
  <p v-else class="note">No account needed. Nicknames for quizzes only.</p>
</template>

<style scoped>
.join-label { display: block; margin-bottom: var(--space-2); font-size: var(--fs-sm); font-weight: 700; }
.join-row {
  display: flex; gap: 10px; padding: var(--space-2); background: var(--card);
  border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow);
}
.code {
  flex: 1; min-width: 0; border: 0; box-shadow: none; padding: 0 14px;
  font-size: var(--fs-lg); font-weight: 800; letter-spacing: 0.35em; font-variant-numeric: tabular-nums;
}
.code::placeholder { color: var(--placeholder); }
.code:focus { box-shadow: none; }
.join-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lead) 15%, transparent); }
.secondary-outline {
  background: var(--card); color: var(--ink); border: 1px solid var(--line); white-space: nowrap;
}
.secondary-outline:hover { background: var(--paper); }
.note { margin: 10px 2px 0; font-size: 0.88rem; color: var(--ink-2); }
.error-text { margin: 10px 2px 0; }
@media (max-width: 760px) {
  .code { font-size: 1rem; letter-spacing: 0.25em; }
  .secondary-outline { padding: var(--space-3) 14px; font-size: 0.92rem; }
}
</style>
