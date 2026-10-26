import { expect, test } from '@playwright/test'
import { closeAudiences, createDeck, joinAudience, quiz } from './helpers'
test.skip(process.env.E2E_SESSIONS !== 'true', 'needs session flag')
test.afterEach(closeAudiences)
test('a separate session preserves title, columns, timer and speed scoring through a real phone flow', async ({ browser, request }) => {
  const deck = await createDeck(request, 'Snapshot regression', [
    { questionType: 'title', question: 'Welcome to the kickoff', body: 'Q4 planning', options: [] },
    { questionType: 'columns', question: 'The plan', columns: [{ title: 'Now', text: 'Ship carefully' }, { title: 'Next', text: 'Learn from the room' }], options: [] },
    { ...quiz('Ready to go?', ['Yes', 'No']), timeLimit: 10 },
  ])
  const headers = { authorization: `Bearer ${deck.token}` }
  const source = (await (await request.get(`/api/presentations/${deck.id}`, { headers })).json()).data
  expect((await request.put(`/api/presentations/${deck.id}`, { headers, data: { quizScoring: 'speed', baseStructureRevision: source.structureRevision } })).ok()).toBe(true)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } })
  try {
    await ctx.addInitScript((token) => { localStorage.setItem('livepoll.token', token); localStorage.setItem('livepoll.user', JSON.stringify({ id: 'e2e', username: 'e2e' })) }, deck.token)
    const stage = await ctx.newPage()
    await stage.goto('/dashboard')
    await stage.locator('.card', { hasText: 'Snapshot regression' }).getByRole('button', { name: 'Start new session' }).click()
    await stage.waitForURL(/\/present\/\d+/)
    const code = stage.url().match(/\/present\/(\d+)/)![1]
    const phone = await joinAudience(browser, code)
    await phone.emulateMedia({ reducedMotion: 'reduce' })
    await expect(phone.getByTestId('layout-title')).toContainText('Q4 planning')
    await phone.screenshot({ path: '/tmp/cf-fixed-session-title.png', fullPage: true })
    await stage.getByRole('button', { name: 'Next →' }).click()
    await expect(phone.getByTestId('layout-columns')).toContainText('Ship carefully')
    await expect(phone.getByTestId('layout-columns')).toContainText('Learn from the room')
    await phone.screenshot({ path: '/tmp/cf-fixed-session-columns.png', fullPage: true })
    await stage.getByRole('button', { name: 'Next →' }).click()
    await phone.getByLabel('Choose your nickname').fill('Session player')
    await phone.getByRole('button', { name: 'Save nickname' }).click()
    const state = (await (await request.get(`/api/live/${code}/state`)).json()).data
    expect(state.quizScoring).toBe('speed')
    expect(state.slides[2].timeLimit).toBe(10)
    // Advancing onto a timed question starts its clock automatically.
    await expect(phone.getByTestId('question-timer')).toBeVisible()
    await phone.locator('.option-button').first().click()
    await expect(phone.getByText(/Answer locked in/)).toBeVisible()
    await phone.reload()
    await expect(phone.getByText(/Answer locked in/)).toBeVisible()
    await expect(phone.getByText(/Time's up|Voting is closed/)).toBeVisible({ timeout: 16000 })
    await phone.screenshot({ path: '/tmp/cf-fixed-session-quiz.png', fullPage: true })
  } finally { await ctx.close() }
})
