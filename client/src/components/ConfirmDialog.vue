<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    busy?: boolean
    error?: string
  }>(),
  { confirmLabel: 'Delete', busy: false, error: '' },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const opener = document.activeElement as HTMLElement | null
onBeforeUnmount(() => { dialog.value?.close(); opener?.focus() })
function containFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const items = Array.from(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  const first = items[0], last = items.at(-1)
  if (!first) { event.preventDefault(); return }
  if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  }
}
const cancelButton = ref<HTMLButtonElement | null>(null)
onMounted(async () => {
  // Focus starts on Cancel: the destructive choice is never the default.
  await nextTick()
  dialog.value?.showModal()
  cancelButton.value?.focus()
})

function cancel() {
  if (!props.busy) emit('cancel')
}
</script>

<template>
  <Teleport to="body"><dialog ref="dialog" class="confirm-overlay" :aria-label="title" @click.self="cancel" @cancel.prevent="cancel" @keydown="containFocus">
    <div class="confirm-sheet">
      <h2 class="confirm-title">{{ title }}</h2>
      <p class="confirm-message">{{ message }}</p>
      <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
      <div class="confirm-actions">
        <button ref="cancelButton" class="button ghost" type="button" :disabled="busy" @click="cancel">Cancel</button>
        <button class="button danger" type="button" :disabled="busy" @click="emit('confirm')">
          <span v-if="busy" class="spinner" aria-hidden="true"></span>{{ confirmLabel }}
        </button>
      </div>
    </div>
  </dialog></Teleport>
</template>

<style scoped>
.confirm-overlay { border: 0; margin: 0; width: 100%; height: 100%; max-width: none; max-height: none; position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgb(0 0 0 / 0.55); padding: var(--space-4); }
.confirm-sheet {
  max-height: 100%; overflow-y: auto; width: min(400px, 100%); padding: var(--space-5);
  background: var(--paper); color: var(--ink); border-radius: 20px; box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.confirm-title { margin: 0 0 var(--space-2); font-size: 1.15rem; }
.confirm-message { margin: 0 0 var(--space-4); color: var(--ink-3); }
.confirm-actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
</style>
