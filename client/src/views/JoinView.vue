<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLiveStore } from '../stores/live'
import { joinPresentation } from '../live/joinPresentation'

const router = useRouter()
const route = useRoute()
const live = useLiveStore()
// A code can arrive from the landing page (?code=123456); keep digits only.
const code = ref(String(route.query.code ?? '').replace(/\D/g, '').slice(0, 6))
const error = ref('')
const busy = ref(false)


async function join() {
  error.value = ''
  const accessCode = code.value.replace(/\D/g, '')
  if (accessCode.length !== 6) {
    error.value = 'Enter the 6-digit code from your presenter.'
    return
  }
  busy.value = true
  try {
    await joinPresentation(live, accessCode)
    router.push({ name: 'audience', params: { code: accessCode } })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not join. Check the code and try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page page-narrow">
    <p class="eyebrow">Interactive presentation</p>
    <h1>Join a presentation</h1>
    <p class="sub">Enter the 6-digit code shown on the presenter's screen. No account needed.</p>
    <div class="card join-card">
      <form @submit.prevent="join">
        <label class="field">
          <span>Join code</span>
          <input
            v-model="code"
            class="code-input"
            inputmode="numeric"
            maxlength="6"
            placeholder="123456"
            autocomplete="off"
          />
        </label>
        <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
        <button class="button big block" type="submit" :disabled="busy">
          <span v-if="busy" class="spinner" aria-hidden="true"></span>{{ busy ? 'Joining…' : 'Join presentation' }}
        </button>
      </form>
    </div>
    <p class="muted" style="text-align:center; margin-top: 28px;">
      Presenting?&nbsp;<router-link class="text-link" to="/login">Log in</router-link>
      &nbsp;or&nbsp;<router-link class="text-link" to="/signup">sign up</router-link>
    </p>
  </div>
</template>
