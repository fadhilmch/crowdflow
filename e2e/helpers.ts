import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

/** Everything here talks to the real server API with the seeded in-memory presenter. */
export interface Deck { id: string; code: string; token: string }

const option = (text: string) => ({ id: crypto.randomUUID(), text })

// One seeded identity per test worker/server. Reusing its session avoids treating the test
// suite's setup traffic as 50 independent login attempts. Production limits stay unchanged.
const workerTokens = new Map<string, string>()
export async function login(request: APIRequestContext): Promise<string> {
  const server = new URL((await request.get('/api/health')).url()).origin
  const existing = workerTokens.get(server)
  if (existing) return existing
  const res = await request.post('/api/users/login', { data: { username: 'demo', password: 'demo1234' } })
  expect(res.ok()).toBeTruthy()
  const token = (await res.json()).token as string
  workerTokens.set(server, token)
  return token
}

export async function createDeck(request: APIRequestContext, title: string, slides: Record<string, unknown>[]): Promise<Deck> {
  const token = await login(request)
  const auth = { authorization: `Bearer ${token}` }
  const created = await (await request.post('/api/presentations', { data: { title }, headers: auth })).json()
  const id = created.data.id ?? created.data._id
  const current = await (await request.get(`/api/presentations/${id}`, { headers: auth })).json()
  const put = await request.put(`/api/presentations/${id}`, {
    headers: auth,
    data: { title, theme: 'iris', baseStructureRevision: current.data.structureRevision ?? 0, slides },
  })
  expect(put.ok()).toBeTruthy()
  const saved = await (await request.get(`/api/presentations/${id}`, { headers: auth })).json()
  return { id, code: saved.data.accessCode, token }
}

export const poll = (question: string, texts: string[]) => ({ questionType: 'multiple-choice', question, options: texts.map(option) })
export function quiz(question: string, texts: string[], correct = 0) {
  const options = texts.map(option)
  return { questionType: 'quiz', question, options, correctOptionId: options[correct].id }
}
export const openEnded = (question: string) => ({ questionType: 'open-ended', question, options: [] })

export async function presenterAction(request: APIRequestContext, deck: Deck, action: Record<string, unknown>) {
  const res = await request.post(`/api/presentations/${deck.id}/live-actions`, { data: action, headers: { authorization: `Bearer ${deck.token}` } })
  expect(res.ok(), await res.text()).toBeTruthy()
}

/** Each audience member gets their own browser context, so storage and cookies never mix. */
const opened: BrowserContext[] = []
/** Closes every audience context a test opened, so open phones do not pile up and slow later tests. */
export async function closeAudiences() {
  await Promise.all(opened.splice(0).map((c) => c.close().catch(() => {})))
}

export async function joinAudience(browser: Browser, code: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } })
  opened.push(context)
  const page = await context.newPage()
  await page.goto(`/join?code=${code}`)
  await page.getByRole('button', { name: /Join presentation/ }).click()
  await page.waitForURL('**/p/**')
  return page
}
