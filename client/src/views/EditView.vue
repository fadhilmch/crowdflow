<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { summarizeConflict } from '../conflictSummary'
import { EditHistory } from '../editHistory'
import { clearDraft, loadDraft, saveDraft } from '../draftStore'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { creationKindFromQuery, creationTemplate } from '../editor/creationTemplates'
import { api, ApiError } from '../api'
import { useAuthStore } from '../stores/auth'
import { THEMES } from '../themes'
import SlidePreview from '../components/SlidePreview.vue'
import SlideSorter from '../components/editor/SlideSorter.vue'
import AddSlideSheet from '../components/editor/AddSlideSheet.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { copySlide } from '../slideCopy'
import { hasOptions, typeLabel, typeHint, type SlideType } from '../editor/slideTypes'
import { isLayoutType } from '../types'
import type { SlideColumn } from '../types'
import { TIME_LIMIT_CHOICES } from '../quizTimer'
import ImageUploadField from '../components/ImageUploadField.vue'

interface EditableOption {
  id?: string
  text: string
}

interface EditableDesign {
  accent?: string
  imageUrl?: string
  imageLayout?: 'beside' | 'behind'
}

interface EditableSlide {
  id?: string
  questionType: SlideType
  question: string
  options: EditableOption[]
  correctOptionId?: string
  design?: EditableDesign
  timeLimit?: number
  body?: string
  columns?: SlideColumn[]
}

interface LoadedSlide {
  id?: string
  questionType: SlideType
  question: string
  options?: { id?: string; text: string }[]
  correctOptionId?: string
  design?: EditableDesign
  timeLimit?: number
  body?: string
  columns?: SlideColumn[]
}

interface LoadedPresentation {
  creationKind?: import('../editor/creationTemplates').CreationKind
  _id: string
  title: string
  location?: string
  accessCode: string
  theme?: string
  structureRevision?: number
  quizScoring?: 'standard' | 'speed'
  slides: LoadedSlide[]
}

interface DraftData {
  title: string
  location: string
  themeId: string
  slides: EditableSlide[]
  quizScoring?: 'standard' | 'speed'
}

const route = useRoute()
const router = useRouter()
const startKind = creationKindFromQuery(route.query.start)
const auth = useAuthStore()
const id = String(route.params.id)

const title = ref('')
const location = ref('')
const accessCode = ref('')
const themeId = ref<string>('iris')
const quizScoring = ref<'standard' | 'speed'>('standard')
const slides = ref<EditableSlide[]>([])
const structureRevision = ref(0)
const loading = ref(true)
const saving = ref(false)
const deleting = ref(false)
const savedAt = ref('')
const error = ref('')
const conflicted = ref(false)
const conflictLines = ref<string[]>([])
let conflictTheirs: LoadedPresentation | null = null
const showValidation = ref(false)
const dirty = ref(false)
const ready = ref(false)
const activeSlide = ref(0)
const copied = ref(false)
const sheetOpen = ref(false)
const previewOpen = ref(false)
const history = new EditHistory()
const historyTick = ref(0) // bumps so the buttons re-read canUndo/canRedo
let restoring = false
const canUndo = computed(() => (historyTick.value, history.canUndo))
const canRedo = computed(() => (historyTick.value, history.canRedo))
const snapshot = () => JSON.stringify({ title: title.value, location: location.value, themeId: themeId.value, slides: slides.value, quizScoring: quizScoring.value })
let savedSnapshot = snapshot()

function applySnapshot(json: string) {
  const d = JSON.parse(json) as DraftData
  restoring = true
  title.value = d.title
  location.value = d.location
  themeId.value = d.themeId
  slides.value = d.slides
  quizScoring.value = d.quizScoring ?? 'standard'
  if (activeSlide.value >= d.slides.length) activeSlide.value = Math.max(0, d.slides.length - 1)
  historyTick.value += 1
  void nextTick(() => { restoring = false })
}
function undo() {
  const s = history.undo()
  if (s) applySnapshot(s)
}
function redo() {
  const s = history.redo()
  if (s) applySnapshot(s)
}
function onHistoryKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
  const el = event.target as HTMLElement | null
  // Inside a text field the browser's own undo handles typing.
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
  event.preventDefault()
  if (event.shiftKey) redo()
  else undo()
}
const pendingDraft = ref<ReturnType<typeof loadDraft<DraftData>>>(null)

const titleError = computed(() => (title.value.trim() ? '' : 'Give the presentation a title.'))

function slideError(slide: EditableSlide): string {
  if (!slide.question.trim()) return isLayoutType(slide.questionType) ? 'Give this slide a title, or remove it.' : 'Give this slide a question, or remove it.'
  if (slide.questionType === 'image' && !slide.design?.imageUrl?.trim()) return 'Upload an image for this slide.'
  if (slide.questionType === 'columns' && (slide.columns ?? []).filter((c) => c.title.trim() || c.text.trim()).length < 2) {
    return 'Fill in at least 2 columns.'
  }
  if (hasOptions(slide.questionType) && slide.options.filter((o) => o.text.trim()).length < 2) {
    return `${typeLabel(slide.questionType)} needs at least 2 options.`
  }
  if (slide.questionType === 'quiz') {
    const keyed = slide.options.some((o) => o.text.trim() && o.id && o.id === slide.correctOptionId)
    if (!keyed) return 'Mark which option is the correct answer.'
  }
  return ''
}

const hasValidationErrors = computed(() => titleError.value !== '' || slides.value.some((s) => slideError(s) !== ''))
const previewSlide = computed(() => slides.value[activeSlide.value] ?? slides.value[0])
const themeName = computed(() => THEMES.find((t) => t.id === themeId.value)?.name ?? '')

const savedSlideCount = ref(0)
function applyLoaded(p: LoadedPresentation) {
  savedSlideCount.value = p.slides.length
  title.value = p.title
  location.value = p.location ?? ''
  accessCode.value = p.accessCode
  themeId.value = p.theme ?? 'iris'
  quizScoring.value = p.quizScoring === 'speed' ? 'speed' : 'standard'
  structureRevision.value = p.structureRevision ?? 0
  slides.value = p.slides.map((s) => ({
    ...(s.timeLimit ? { timeLimit: s.timeLimit } : {}),
    ...(s.body ? { body: s.body } : {}),
    ...(s.columns?.length ? { columns: s.columns.map((c) => ({ title: c.title ?? '', text: c.text ?? '' })) } : {}),
    id: s.id,
    questionType: s.questionType,
    question: s.question,
    options: (s.options ?? []).map((o) => ({ id: o.id, text: o.text })),
    correctOptionId: s.correctOptionId,
    design: s.design ? { ...s.design } : {},
  }))
  savedSnapshot = snapshot()
  if (!slides.value.length) {
    // Fresh decks open with the starter for the chosen creation kind; Blank starts empty.
    const starter = creationTemplate(p.creationKind ?? startKind ?? 'presentation').starterSlide
    if (starter) addSlide(starter)
  }
  dirty.value = snapshot() !== savedSnapshot
  restoring = true
  void nextTick(() => { restoring = false; history.reset(snapshot()); historyTick.value += 1 })
}

async function keepMine() {
  if (!conflictTheirs) return
  structureRevision.value = conflictTheirs.structureRevision ?? 0
  conflicted.value = false
  conflictLines.value = []
  error.value = ''
  await save()
}

function useTheirs() {
  if (!conflictTheirs) return
  // Keep my edits as a local draft so nothing is lost; the banner offers to restore them.
  saveDraft<DraftData>(id, conflictTheirs.structureRevision ?? 0, {
    title: title.value,
    location: location.value,
    themeId: themeId.value,
    quizScoring: quizScoring.value,
    slides: JSON.parse(JSON.stringify(slides.value)),
  })
  applyLoaded(conflictTheirs)
  pendingDraft.value = loadDraft<DraftData>(id)
  conflicted.value = false
  conflictLines.value = []
  error.value = ''
  conflictTheirs = null
}

async function reload() {
  const res = await api.getPresentation(auth.token, id)
  applyLoaded(res.data as unknown as LoadedPresentation)
  conflicted.value = false
  showValidation.value = false
}

onMounted(async () => {
  try {
    await reload()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load presentation.'
  } finally {
    loading.value = false
    ready.value = true
  }
  const draft = loadDraft<DraftData>(id)
  if (draft && draft.basedOnRevision === structureRevision.value && JSON.stringify(draft.data.slides) !== JSON.stringify(slides.value)) {
    pendingDraft.value = draft
  } else if (draft) {
    clearDraft(id)
  }
  window.addEventListener('beforeunload', warnUnsaved)
  window.addEventListener('keydown', onHistoryKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', warnUnsaved)
  window.removeEventListener('keydown', onHistoryKey)
})

watch([title, location, themeId, slides, quizScoring], () => {
  if (!ready.value) return
  dirty.value = snapshot() !== savedSnapshot
  if (!restoring) {
    history.record(snapshot())
    historyTick.value += 1
  }
  if (!dirty.value && !pendingDraft.value) clearDraft(id)
  else if (!pendingDraft.value) {
    saveDraft<DraftData>(id, structureRevision.value, {
      title: title.value,
      location: location.value,
      themeId: themeId.value,
      quizScoring: quizScoring.value,
      slides: JSON.parse(JSON.stringify(slides.value)),
    })
  }
}, { deep: true })

function restoreDraft() {
  const d = pendingDraft.value
  if (!d) return
  title.value = d.data.title
  location.value = d.data.location
  themeId.value = d.data.themeId
  slides.value = d.data.slides
  quizScoring.value = d.data.quizScoring ?? 'standard'
  pendingDraft.value = null
}

function discardDraft() {
  clearDraft(id)
  pendingDraft.value = null
}

function warnUnsaved(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault()
}

onBeforeRouteLeave(() => {
  if (dirty.value && !window.confirm('You have unsaved changes. Leave without saving?')) return false
})

const questionInput = ref<HTMLInputElement | null>(null)

async function addSlide(type: SlideType) {
  sheetOpen.value = false
  slides.value.push({
    questionType: type,
    question: '',
    options: hasOptions(type) ? [{ id: crypto.randomUUID(), text: '' }, { id: crypto.randomUUID(), text: '' }] : [],
    design: {},
    ...(type === 'columns' ? { columns: [{ title: '', text: '' }, { title: '', text: '' }] } : {}),
  })
  activeSlide.value = slides.value.length - 1
  await nextTick()
  questionInput.value?.focus()
}

function duplicateSlide(index: number) {
  const copy = copySlide(slides.value[index])
  slides.value.splice(index + 1, 0, copy)
  activeSlide.value = index + 1
}

function removeSlide(index: number) {
  slides.value.splice(index, 1)
  activeSlide.value = Math.min(activeSlide.value, slides.value.length - 1)
}

function moveSlide(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= slides.value.length) return
  const [moved] = slides.value.splice(index, 1)
  slides.value.splice(target, 0, moved)
  activeSlide.value = target
}

/** Drag reorder from the sorter: remove the slide at `from`, insert it at `to`. */
function reorderSlide(from: number, to: number) {
  if (from === to) return
  const [moved] = slides.value.splice(from, 1)
  slides.value.splice(to, 0, moved)
  activeSlide.value = to
}

/** Radio-group keys: arrows move and select, Home/End jump. Only the selected option is a tab stop. */
function onThemeKey(event: KeyboardEvent) {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
  const current = THEMES.findIndex((t) => t.id === themeId.value)
  let next = -1
  if (event.key in keys) next = (current + keys[event.key] + THEMES.length) % THEMES.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = THEMES.length - 1
  if (next < 0) return
  event.preventDefault()
  themeId.value = THEMES[next].id
  const group = (event.currentTarget as HTMLElement).parentElement
  ;(group?.querySelectorAll<HTMLElement>('[role=radio]')[next])?.focus()
}

const joinLink = computed(() => (accessCode.value ? `${window.location.origin}/p/${accessCode.value}` : ''))

async function copyJoinLink() {
  const link = joinLink.value
  if (!link) return
  try {
    await navigator.clipboard.writeText(link)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = link
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

function addOption(slide: EditableSlide) {
  slide.options.push({ id: crypto.randomUUID(), text: '' })
}

function setImage(slide: EditableSlide, url: string | undefined) {
  slide.design = { ...slide.design, imageUrl: url }
}

function setAccent(slide: EditableSlide, color?: string) {
  slide.design = { ...slide.design, accent: color }
}

function addColumn(slide: EditableSlide) {
  if ((slide.columns?.length ?? 0) < 3) slide.columns = [...(slide.columns ?? []), { title: '', text: '' }]
}
function removeColumn(slide: EditableSlide, index: number) {
  slide.columns = (slide.columns ?? []).filter((_, i) => i !== index)
}
function setTimeLimit(slide: EditableSlide, value: string) {
  if (value) slide.timeLimit = Number(value)
  else delete slide.timeLimit
}

function removeOption(slide: EditableSlide, index: number) {
  slide.options.splice(index, 1)
}

function savePayload(confirmRemove?: { votes: number; responses: number }) {
  return {
    title: title.value.trim(),
    location: location.value.trim() || null,
    theme: themeId.value,
    quizScoring: quizScoring.value,
    baseStructureRevision: structureRevision.value,
    confirmRemove,
    slides: slides.value.map((s) => {
      const options = hasOptions(s.questionType)
        ? s.options.filter((o) => o.text.trim()).map((o) => ({ id: o.id, text: o.text.trim() }))
        : []
      const design = s.design && (s.design.accent || s.design.imageUrl?.trim())
        ? {
            ...(s.design.accent ? { accent: s.design.accent } : {}),
            ...(s.design.imageUrl?.trim() ? { imageUrl: s.design.imageUrl.trim(), imageLayout: s.design.imageLayout ?? 'beside' } : {}),
          }
        : undefined
      return {
        id: s.id,
        questionType: s.questionType,
        question: s.question.trim(),
        options,
        ...(s.questionType === 'quiz' && s.correctOptionId ? { correctOptionId: s.correctOptionId } : {}),
        ...(s.questionType === 'quiz' && s.timeLimit ? { timeLimit: s.timeLimit } : {}),
        ...(s.questionType === 'title' && s.body?.trim() ? { body: s.body.trim() } : {}),
        ...(s.questionType === 'columns' ? { columns: (s.columns ?? []).map((c) => ({ title: c.title.trim(), text: c.text.trim() })).filter((c) => c.title || c.text) } : {}),
        ...(design ? { design } : {}),
      }
    }),
  }
}

function describeLoss(votes: number, responses: number): string {
  const parts: string[] = []
  if (votes) parts.push(`${votes} vote${votes === 1 ? '' : 's'}`)
  if (responses) parts.push(`${responses} response${responses === 1 ? '' : 's'}`)
  return parts.join(' and ')
}

async function save() {
  error.value = ''
  showValidation.value = true
  if (hasValidationErrors.value) return
  saving.value = true
  try {
    await attemptSave()
  } finally {
    saving.value = false
  }
}

async function attemptSave(alreadyRetried = false) {
  try {
    const res = await api.updatePresentation(auth.token, id, savePayload())
    applyLoaded(res.data as unknown as LoadedPresentation)
    clearDraft(id)
    savedAt.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 409) {
      error.value = err instanceof Error ? err.message : 'Could not save.'
      return
    }
    const { code, removedVotes = 0, removedResponses = 0 } = err.body
    if (code === 'requiresConfirmation') {
      const loss = describeLoss(removedVotes, removedResponses)
      confirmDialog.value = {
        title: 'Save these changes?',
        message: `Saving removes slides or options that already have ${loss}. Delete those results?`,
        confirmLabel: 'Save anyway',
        action: async () => {
          try {
            const res = await api.updatePresentation(auth.token, id, savePayload({ votes: removedVotes, responses: removedResponses }))
            applyLoaded(res.data as unknown as LoadedPresentation)
            savedAt.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          } catch (retryErr) {
            error.value =
              retryErr instanceof ApiError && retryErr.status === 409
                ? 'New votes came in while you were deciding. Review the slides and save again.'
                : retryErr instanceof Error
                  ? retryErr.message
                  : 'Could not save.'
          }
        },
      }
      return
    }
    if ((code === 'upgraded' || code === 'stale') && !alreadyRetried) {
      // Identities were missing or stale. If the structure has not changed
      // since we loaded, graft the fresh ids on by position and retry once.
      const fresh = (await api.getPresentation(auth.token, id)).data as unknown as LoadedPresentation
      const sameShape =
        (fresh.structureRevision ?? 0) === structureRevision.value &&
        fresh.slides.length === slides.value.length &&
        fresh.slides.every((fs, i) => (fs.options?.length ?? 0) === slides.value[i].options.length)
      if (!sameShape) {
        applyLoaded(fresh)
        error.value = 'This presentation changed since you opened it. Review the reloaded slides, then save again.'
        return
      }
      fresh.slides.forEach((freshSlide, i) => {
        slides.value[i].id = freshSlide.id
        freshSlide.options?.forEach((freshOption, oi) => {
          if (slides.value[i].options[oi]) slides.value[i].options[oi].id = freshOption.id
        })
      })
      structureRevision.value = fresh.structureRevision ?? 0
      await attemptSave(true)
      return
    }
    if (code === 'conflict') {
      conflicted.value = true
      error.value = 'These slides were changed elsewhere. Choose which version to keep.'
      try {
        conflictTheirs = (await api.getPresentation(auth.token, id)).data as unknown as LoadedPresentation
        conflictLines.value = summarizeConflict(
          { title: title.value, slides: slides.value },
          { title: conflictTheirs.title, slides: conflictTheirs.slides.map((sl) => ({ ...sl, options: sl.options ?? [] })) },
        )
      } catch {
        conflictLines.value = []
      }
      return
    }
    error.value = err.message
  }
}

interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  action: () => void | Promise<void>
}
const confirmDialog = ref<ConfirmRequest | null>(null)

async function runConfirmed() {
  const pending = confirmDialog.value
  if (!pending) return
  await pending.action()
  confirmDialog.value = null
}

function remove() {
  if (deleting.value) return
  confirmDialog.value = {
    title: 'Delete this presentation?',
    message: 'This deletes the presentation and all its results. It cannot be undone.',
    confirmLabel: 'Delete',
    action: async () => {
      deleting.value = true
      try {
        await api.deletePresentation(auth.token, id)
        dirty.value = false
        clearDraft(id)
        router.push({ name: 'dashboard' })
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'Could not delete.'
        deleting.value = false
      }
    },
  }
}
</script>

<template>
  <div class="page editor-page">
    <div v-if="loading" aria-label="Loading editor" style="margin-top:20px; display:flex; flex-direction:column; gap:14px;">
      <div class="skel" style="height:38px; max-width:280px;"></div>
      <div class="skel skel-card" style="height:180px;"></div>
      <div class="skel skel-card" style="height:120px;"></div>
    </div>
    <template v-else>
      <h1 class="visually-hidden">Edit presentation</h1>
      <div v-if="pendingDraft" class="error-banner" role="status" data-testid="draft-banner">
        Unsaved changes from {{ new Date(pendingDraft.savedAt).toLocaleString() }} were found in this browser.
        <button class="button ghost" @click="restoreDraft">Restore</button>
        <button class="button ghost" @click="discardDraft">Discard</button>
      </div>
      <div class="editor-header">
        <div class="editor-join">
          <span v-if="accessCode" class="join-cluster">
            <span class="join-label">Join code <span class="muted join-hint">- your audience enters this to watch and answer</span></span>
            <span class="code-chip">{{ accessCode }}</span>
          </span>
          <button v-if="accessCode" class="button ghost copy-link" :aria-label="copied ? 'Copied' : 'Copy join link'" @click="copyJoinLink">
            <svg class="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
            <span class="lbl">{{ copied ? 'Copied ✓' : 'Copy join link' }}</span>
          </button>
        </div>
        <div class="editor-actions">
          <button class="button ghost hist-btn" :disabled="!canUndo" aria-label="Undo" title="Undo (Ctrl+Z)" @click="undo"><span class="ic" aria-hidden="true">↶</span><span class="lbl">Undo</span></button>
          <button class="button ghost hist-btn" :disabled="!canRedo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" @click="redo"><span class="ic" aria-hidden="true">↷</span><span class="lbl">Redo</span></button>
          <span class="muted saved-at" role="status">{{ dirty ? 'Unsaved changes' : savedAt ? `Saved ${savedAt}` : 'No unsaved changes' }}</span>
          <router-link v-if="savedSlideCount && slides.length" class="button ghost" :to="{ name: 'present', params: { code: accessCode } }">Present</router-link>
          <span v-else class="muted" role="status">Add and save a slide to present.</span>
          <button class="button danger" :disabled="deleting" @click="remove">
            <span v-if="deleting" class="spinner" aria-hidden="true"></span>{{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
          <button class="button big" :disabled="saving" @click="save">
            <span v-if="saving" class="spinner" aria-hidden="true"></span>{{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>

      <p v-if="error" class="error-banner" role="alert">
        {{ error }}
        <button v-if="conflicted && !conflictLines.length" class="button ghost" style="margin-left:var(--space-2);" @click="reload">Reload</button>
      </p>
      <div v-if="conflicted && conflictLines.length" class="card" role="group" aria-label="Resolve conflict" data-testid="conflict-panel">
        <h2>What changed</h2>
        <ul><li v-for="(line, i) in conflictLines" :key="i">{{ line }}</li></ul>
        <button class="button" @click="keepMine">Keep my version (replaces the saved one)</button>
        <button class="button ghost" @click="useTheirs">Use the saved version (my edits stay as a draft)</button>
      </div>

      <div class="editor-grid">
        <aside class="sorter-col" aria-label="Slide sorter">
          <SlideSorter
            :slides="slides"
            :active="activeSlide"
            :theme-id="themeId"
            @select="activeSlide = $event"
            @reorder="reorderSlide"
            @add="sheetOpen = true"
          />
        </aside>

        <div class="form-col">
          <div v-if="previewSlide" class="card slide-form" :key="activeSlide">
            <div class="slide-form-head">
              <span class="slide-type">Slide {{ activeSlide + 1 }} · {{ typeLabel(previewSlide.questionType) }}</span>
              <span class="slide-tools">
                <button class="icon-button" title="Move slide up" :aria-label="`Move slide ${activeSlide + 1} up`" :disabled="activeSlide === 0" @click="moveSlide(activeSlide, -1)">↑</button>
                <button class="icon-button" title="Move slide down" :aria-label="`Move slide ${activeSlide + 1} down`" :disabled="activeSlide === slides.length - 1" @click="moveSlide(activeSlide, 1)">↓</button>
                <button class="icon-button" title="Duplicate slide" :aria-label="`Duplicate slide ${activeSlide + 1}`" @click="duplicateSlide(activeSlide)">⧉</button>
                <button class="icon-button" title="Remove slide" :aria-label="`Remove slide ${activeSlide + 1}`" @click="removeSlide(activeSlide)">✕</button>
              </span>
            </div>
            <label class="field">
              <span>{{ isLayoutType(previewSlide.questionType) ? (previewSlide.questionType === 'image' ? 'Caption' : 'Title') : 'Question' }}</span>
              <input ref="questionInput" v-model="previewSlide.question" maxlength="300" placeholder="What should we focus on next quarter?" />
            </label>
            <template v-if="hasOptions(previewSlide.questionType)">
              <div v-for="(option, oi) in previewSlide.options" :key="option.id ?? `new-${oi}`" class="option-row">
                <label v-if="previewSlide.questionType === 'quiz'" class="correct-toggle" :title="'Mark as correct answer'">
                  <input
                    type="radio"
                    :name="`correct-${previewSlide.id ?? activeSlide}`"
                    :checked="previewSlide.correctOptionId === option.id"
                    @change="previewSlide.correctOptionId = option.id"
                  />
                  <span>correct</span>
                </label>
                <input v-model="option.text" maxlength="200" :placeholder="`Option ${oi + 1}`" :aria-label="`Slide ${activeSlide + 1}, option ${oi + 1}`" />
                <button class="icon-button" title="Remove option" :aria-label="`Remove option ${oi + 1}`" @click="removeOption(previewSlide, oi)">✕</button>
              </div>
              <button class="button ghost" @click="addOption(previewSlide)">+ Add option</button>
              <p v-if="previewSlide.questionType === 'quiz'" class="muted" style="margin:6px 0 0;">The correct answer is revealed when you close voting. After that the stage shows how many got it right and a leaderboard of the names players chose.</p>
            </template>
            <label v-if="previewSlide.questionType === 'quiz'" class="field" style="margin-top:var(--space-3);">
              <span>Time limit</span>
              <select :value="previewSlide.timeLimit ?? ''" data-testid="time-limit" @change="setTimeLimit(previewSlide, ($event.target as HTMLSelectElement).value)">
                <option value="">No limit</option>
                <option v-for="t in TIME_LIMIT_CHOICES" :key="t" :value="t">{{ t }} seconds</option>
              </select>
              <small class="muted">With a limit, you start the countdown on stage and answers close when it ends. Without one, players answer until you close voting.</small>
            </label>
            <label v-if="previewSlide.questionType === 'title'" class="field">
              <span>Subtitle <span class="muted">(optional)</span></span>
              <input v-model="previewSlide.body" maxlength="400" placeholder="Quarterly kickoff" />
            </label>
            <template v-if="previewSlide.questionType === 'columns'">
              <div v-for="(column, ci) in previewSlide.columns" :key="ci" class="option-row column-row">
                <div class="column-fields">
                  <input v-model="column.title" maxlength="80" :placeholder="`Column ${ci + 1} heading`" :aria-label="`Column ${ci + 1} heading`" />
                  <textarea v-model="column.text" rows="2" maxlength="600" :placeholder="`Column ${ci + 1} text`" :aria-label="`Column ${ci + 1} text`"></textarea>
                </div>
                <button v-if="(previewSlide.columns?.length ?? 0) > 2" class="icon-button" title="Remove column" :aria-label="`Remove column ${ci + 1}`" @click="removeColumn(previewSlide, ci)">✕</button>
              </div>
              <button v-if="(previewSlide.columns?.length ?? 0) < 3" class="button ghost" @click="addColumn(previewSlide)">+ Add column</button>
            </template>
            <div v-if="previewSlide.questionType === 'image'" class="field">
              <span>Image</span>
              <ImageUploadField :model-value="previewSlide.design?.imageUrl" :token="auth.token" required @update:model-value="setImage(previewSlide, $event)" />
            </div>
            <p v-if="typeHint(previewSlide.questionType) && previewSlide.questionType !== 'quiz'" class="muted" style="margin:0;">{{ typeHint(previewSlide.questionType) }}</p>

            <details class="design-panel">
              <summary>Slide design <span class="muted">(optional)</span></summary>
              <div class="design-body">
                <span class="field-label">Accent</span>
                <div class="accent-row">
                  <button
                    class="accent-swatch none"
                    :class="{ sel: !previewSlide.design?.accent }"
                    title="Theme default"
                    @click="setAccent(previewSlide, undefined)"
                  >A</button>
                  <button
                    v-for="c in THEMES.find((t) => t.id === themeId)?.pal ?? THEMES[0].pal"
                    :key="c"
                    class="accent-swatch"
                    :class="{ sel: previewSlide.design?.accent === c }"
                    :style="{ background: c }"
                    :title="c"
                    @click="setAccent(previewSlide, c)"
                  ></button>
                </div>
                <div v-if="previewSlide.questionType !== 'image'" class="field" style="margin-top:10px;">
                  <span>Image <span class="muted">(optional)</span></span>
                  <ImageUploadField :model-value="previewSlide.design?.imageUrl" :token="auth.token" @update:model-value="setImage(previewSlide, $event)" />
                </div>
                <label v-if="previewSlide.design?.imageUrl && previewSlide.questionType !== 'image'" class="field" style="margin-bottom:0;">
                  <span>Image placement</span>
                  <select v-model="previewSlide.design!.imageLayout">
                    <option value="beside">Beside the question</option>
                    <option value="behind">Behind the question</option>
                  </select>
                </label>
              </div>
            </details>
            <p v-if="showValidation && slideError(previewSlide)" class="slide-error" role="alert">{{ slideError(previewSlide) }}</p>
          </div>
          <div v-else class="card slide-form empty-form">
            <p class="muted" style="margin:0;">No slides yet. Add your first one from the sorter.</p>
          </div>

          <details class="card title-theme">
            <summary>
              <span class="tt-label">Title &amp; theme</span>
              <span class="muted tt-current">{{ title.trim() || 'Untitled presentation' }} · {{ themeName }}</span>
            </summary>
            <div class="tt-body">
              <label class="field">
                <span>Title</span>
                <input v-model="title" maxlength="120" placeholder="All-hands kickoff" />
              </label>
              <p v-if="showValidation && titleError" class="slide-error" role="alert">{{ titleError }}</p>
              <label class="field"><span>Location <span class="muted">(optional)</span></span><input v-model="location" maxlength="120" placeholder="Stockholm office" /></label>
              <label class="field">
                <span>Quiz scoring</span>
                <select v-model="quizScoring" data-testid="quiz-scoring">
                  <option value="standard">Standard: 1 point per correct answer</option>
                  <option value="speed">Speed: faster correct answers score more (500 to 1000)</option>
                </select>
              </label>
              <h2 class="tt-theme-title">Theme</h2>
              <p class="muted" style="margin:0 0 10px;">Colors for this presentation's stage and audience screens. The rest of the app keeps the standard CrowdFlow look.</p>
              <div class="theme-picker" role="radiogroup" aria-label="Presentation theme">
                <button
                  v-for="t in THEMES"
                  :key="t.id"
                  type="button"
                  role="radio"
                  :aria-checked="themeId === t.id"
                  :tabindex="themeId === t.id ? 0 : -1"
                  class="theme-option"
                  :class="{ sel: themeId === t.id }"
                  @click="themeId = t.id"
                  @keydown="onThemeKey"
                >
                  <span class="theme-mini" :style="{ background: t.sbg }">
                    <span class="mq"></span>
                    <span class="mb"><i v-for="(c, j) in t.pal.slice(0, 3)" :key="j" :style="{ height: ['46%','82%','60%'][j], background: c }"></i></span>
                    <span class="ml" :style="{ background: t.acc }"></span>
                  </span>
                  <span class="theme-name">{{ t.name }}</span>
                </button>
              </div>
            </div>
          </details>
        </div>

        <aside class="preview-col">
          <div class="preview-pin">
            <div class="preview-head">
              <h2 class="preview-title">Stage preview · Slide {{ activeSlide + 1 }} of {{ slides.length }}</h2>
              <span class="muted">updates as you type</span>
            </div>
            <SlidePreview v-if="previewSlide" :slide="previewSlide" :theme-id="themeId" />
            <p v-else class="muted" style="margin:0;">Add a slide to preview it here.</p>
            <p class="muted preview-note">This is what the room sees when you present slide {{ activeSlide + 1 }}. Click another slide in the sorter to preview it here.</p>
          </div>
        </aside>
      </div>

      <AddSlideSheet :open="sheetOpen" :theme-id="themeId" @pick="addSlide" @close="sheetOpen = false" />
      <ConfirmDialog
        v-if="confirmDialog"
        :title="confirmDialog.title"
        :message="confirmDialog.message"
        :confirm-label="confirmDialog.confirmLabel"
        :busy="deleting"
        @confirm="runConfirmed"
        @cancel="confirmDialog = null"
      />

      <!-- Phone: the stage preview docks at the bottom and expands when tapped. -->
      <div v-if="previewSlide" class="dock">
        <button type="button" class="dock-bar" :aria-expanded="previewOpen" @click="previewOpen = !previewOpen">
          <span class="dock-label">Stage preview · Slide {{ activeSlide + 1 }}<span class="dock-sub">updates as you type</span></span>
          <span class="dock-chev" :class="{ open: previewOpen }" aria-hidden="true">⌃</span>
        </button>
        <div v-if="previewOpen" class="dock-body">
          <SlidePreview :slide="previewSlide" :theme-id="themeId" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.editor-page {
  max-width: 1320px;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}
.editor-join {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.join-cluster {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.join-label {
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
}
.join-hint {
  font-weight: 400;
  white-space: normal;
}
.code-chip {
  font-weight: 800;
  letter-spacing: 0.18em;
  background: var(--accent-soft);
  color: var(--accent-strong);
  padding: 5px var(--space-3);
  border-radius: var(--radius-sm);
  font-variant-numeric: tabular-nums;
}
.copy-link {
  padding: 5px var(--space-3);
  font-size: var(--fs-sm);
}
.editor-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
/* Icon forms of compact controls; only shown in the phone toolbar. */
.copy-link .ic, .hist-btn .ic { display: none; }

.editor-grid {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 360px;
  gap: var(--space-5);
  align-items: start;
  margin-top: var(--space-4);
}
.sorter-col,
.preview-pin {
  position: sticky;
  top: var(--space-5);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.form-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.slide-form-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-3);
}
.slide-type {
  font-size: var(--fs-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.slide-tools {
  display: flex;
  gap: 6px;
}
.empty-form {
  text-align: center;
  padding: var(--space-6);
}

.title-theme {
  padding: 0;
  overflow: hidden;
}
.title-theme summary {
  cursor: pointer;
  padding: var(--space-4) var(--space-5);
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.tt-label {
  font-size: var(--fs-xs);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.tt-current {
  font-size: var(--fs-sm);
}
.tt-body {
  padding: 0 var(--space-5) var(--space-5);
}
.tt-theme-title {
  font-size: var(--fs-base);
  margin: var(--space-3) 0 var(--space-1);
}

.preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.preview-title {
  margin: 0;
  font-size: var(--fs-md);
}
.preview-note {
  margin: 10px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
}

/* Busy spinner, mirroring the shared busy-button pattern. */
.spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: none;
  vertical-align: -0.12em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 1.8s; }
}

.column-row { align-items: flex-start; }
.column-fields { flex: 1; display: grid; gap: var(--space-2); min-width: 0; }
.option-row {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.correct-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  font-weight: 700;
  color: var(--ink-2);
  flex-shrink: 0;
  cursor: pointer;
}
.design-panel {
  margin-top: var(--space-3);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  padding-top: 10px;
}
.design-panel summary {
  cursor: pointer;
  font-weight: 700;
  font-size: var(--fs-base);
}
.design-body {
  margin-top: 10px;
}
.field-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 700;
  margin-bottom: 6px;
}
.accent-row {
  display: flex;
  gap: var(--space-2);
}
.accent-swatch {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.accent-swatch.none {
  background: var(--card);
  border-color: var(--line);
  font-weight: 800;
  color: var(--ink-2);
}
.accent-swatch.sel {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.slide-error {
  margin: 6px 0 0;
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--danger-ink);
}

/* Phone dock: hidden on desktop. */
.dock {
  display: none;
}

@media (max-width: 1023px) {
  .editor-page {
    padding-bottom: 120px; /* room for the docked preview bar */
  }
  .editor-grid {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
  }
  /* Phone toolbar: two compact rows instead of three wrapped ones.
     Row 1: join code + copy, Save pinned right. Row 2: undo/redo, Present, Delete. */
  .editor-header {
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    justify-content: flex-start;
  }
  .editor-join, .editor-actions { display: contents; }
  /* Phone: keep a compact caption above the chip instead of dropping the explanation. */
  .join-cluster { order: 1; display: inline-flex; flex-direction: column; align-items: flex-start; gap: 1px; }
  .join-hint { display: none; }
  .join-label { font-size: var(--fs-xs); font-weight: 600; color: var(--ink-3); white-space: nowrap; }
  /* Row 1: join code + copy, Save pinned right. Row 2: undo/redo, Present, Delete. Status on its own line. */
  .copy-link { order: 2; }
  .editor-header .button.big { order: 3; margin-left: auto; }
  .saved-at { order: 4; flex-basis: 100%; text-align: left; }
  .hist-btn { order: 5; }
  .editor-actions > .button.ghost:not(.hist-btn) { order: 6; }
  .editor-actions > span.muted:not(.saved-at) { order: 6; }
  .editor-actions > .button.danger { order: 7; margin-left: auto; }
  .editor-header .button {
    min-height: 40px;
    padding: 0 var(--space-3);
    font-size: var(--fs-sm);
  }
  .copy-link .lbl, .hist-btn .lbl { display: none; }
  .copy-link .ic, .hist-btn .ic { display: inline-flex; }
  .copy-link, .hist-btn { width: 40px; justify-content: center; }
  .hist-btn .ic { font-size: 1.15rem; line-height: 1; }
  /* Let the sorter shrink below its content width so the thumbnail strip
     scrolls internally instead of widening the page. */
  .editor-grid > * {
    min-width: 0;
  }
  .sorter-col,
  .preview-pin {
    position: static;
    max-height: none;
    overflow: visible;
  }
  .preview-col {
    display: none;
  }
  .dock {
    display: block;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    background: var(--card);
    border-top: 1px solid var(--line);
    box-shadow: 0 -8px 24px rgb(28 32 36 / 0.10);
  }
  .dock-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .dock-label {
    font-weight: 800;
    font-size: var(--fs-base);
    display: flex;
    flex-direction: column;
  }
  .dock-sub {
    font-weight: 500;
    font-size: var(--fs-xs);
    color: var(--ink-3);
  }
  .dock-chev {
    font-size: 1.1rem;
    color: var(--ink-3);
    transition: transform var(--dur-fast) var(--ease);
  }
  .dock-chev.open {
    transform: rotate(180deg);
  }
  .dock-body {
    max-height: 55vh;
    overflow-y: auto;
    padding: 0 var(--space-4) var(--space-4);
  }
}
@media (max-width: 1023px) and (prefers-reduced-motion: reduce) {
  .dock-chev { transition: none; }
}
</style>
