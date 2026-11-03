<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { radioIndex } from '../editor/dialogKeys'
import { CREATION_TEMPLATES, creationTemplate, type CreationKind } from '../editor/creationTemplates'

const props = withDefaults(defineProps<{ open: boolean; busy?: boolean; error?: string }>(), { busy: false, error: '' })
const emit = defineEmits<{ create: [kind: CreationKind, title: string]; close: [] }>()

const kind = ref<CreationKind>('quiz')
const title = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
let opener: HTMLElement | null = null
function containFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const items = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled)') ?? [])
  const first = items[0], last = items.at(-1)
  if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  }
}
function moveChoice(event: KeyboardEvent) {
  const index = CREATION_TEMPLATES.findIndex(t => t.kind === kind.value)
  const next = radioIndex(event.key, index, CREATION_TEMPLATES.length)
  if (next === null) return
  event.preventDefault()
  kind.value = CREATION_TEMPLATES[next].kind
  void nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      opener = document.activeElement as HTMLElement | null
      kind.value = 'quiz'
      title.value = ''
      await nextTick()
      dialog.value?.showModal()
      nameInput.value?.focus()
    } else {
      dialog.value?.close()
      opener?.focus()
    }
  },
)

function close() {
  if (!props.busy) emit('close')
}

function submit() {
  const trimmed = title.value.trim()
  if (!trimmed || props.busy) return
  emit('create', kind.value, trimmed)
}
</script>

<template>
  <Teleport to="body">
    <dialog v-if="open" ref="dialog" class="np-overlay" aria-label="New presentation" @click.self="close" @cancel.prevent="close" @keydown="containFocus">
      <div class="np-sheet">
        <h2 class="np-title">New presentation</h2>
        <p class="np-sub">Choose how it starts. You can mix every slide type in the editor either way.</p>
        <div class="np-choices" role="radiogroup" aria-label="Starting point" @keydown="moveChoice">
          <button
            v-for="t in CREATION_TEMPLATES"
            :key="t.kind"
            type="button"
            class="np-card"
            :class="{ sel: kind === t.kind }"
            role="radio"
            :aria-checked="kind === t.kind"
            :tabindex="kind === t.kind ? 0 : -1"
            @click="kind = t.kind"
          >
            <b>{{ t.name }}</b>
            <span class="np-blurb">{{ t.blurb }}</span>
          </button>
        </div>
        <label class="field">
          <span>Name</span>
          <input
            ref="nameInput"
            v-model="title"
            maxlength="120"
            :placeholder="creationTemplate(kind).namePlaceholder"
            @keydown.enter.prevent="submit"
          />
        </label>
        <p v-if="error" class="slide-error" role="alert">{{ error }}</p>
        <div class="np-actions">
          <button class="button ghost" type="button" :disabled="busy" @click="close">Cancel</button>
          <button class="button big" type="button" :disabled="busy || !title.trim()" @click="submit">
            <span v-if="busy" class="spinner" aria-hidden="true"></span>{{ busy ? 'Creating…' : 'Create' }}
          </button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.np-overlay {
  border: 0; margin: 0; width: 100%; height: 100%; max-width: none; max-height: none;
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;
  background: rgb(0 0 0 / 0.55); padding: var(--space-4);
}
.np-sheet {
  max-height: 100%; overflow-y: auto; width: min(560px, 100%); padding: var(--space-5);
  background: var(--paper); color: var(--ink); border-radius: 20px; box-shadow: 0 24px 60px rgb(0 0 0 / 0.4);
}
.np-title { margin: 0 0 var(--space-2); font-size: 1.15rem; }
.np-sub { margin: 0 0 var(--space-4); color: var(--ink-3); }
.np-choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin-bottom: var(--space-4); }
.np-card {
  display: flex; flex-direction: column; gap: var(--space-1); text-align: left;
  padding: var(--space-3); border-radius: 14px; border: 2px solid var(--line);
  background: transparent; color: var(--ink); cursor: pointer; font: inherit;
}
.np-card:hover { border-color: var(--ink-3); }
.np-card.sel { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.np-blurb { font-size: var(--fs-sm); color: var(--ink-3); line-height: 1.35; }
.np-actions { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4); }
@media (max-width: 560px) {
  .np-choices { grid-template-columns: 1fr; }
}
</style>
