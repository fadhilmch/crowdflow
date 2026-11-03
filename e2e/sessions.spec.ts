import { expect, test } from '@playwright/test'
import { createDeck, joinAudience, poll } from './helpers'

test.skip(process.env.E2E_SESSIONS !== 'true', 'needs the server started with SESSIONS_ENABLED=true (E2E_SESSIONS=true)')

test('starting a session gives a new code; answers stay with the run, not the deck', async ({ browser, request }) => {
  const deck = await createDeck(request, 'E2E sessions', [poll('Pick one', ['Alpha', 'Beta'])])
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } })
  await ctx.addInitScript((token) => { localStorage.setItem('livepoll.token', token); localStorage.setItem('livepoll.user', JSON.stringify({ id: 'e2e', username: 'e2e' })) }, deck.token)
  const page = await ctx.newPage()
  await page.goto('/dashboard')
  await page.locator('.card', { hasText: 'E2E sessions' }).getByRole('button', { name: 'Start new session' }).click()
  await page.waitForURL(/\/present\/(\d+)/)
  const sessionCode = page.url().match(/\/present\/(\d+)/)![1]
  expect(sessionCode).not.toBe(deck.code)

  const voter = await joinAudience(browser, sessionCode)
  await voter.getByRole('button', { name: /Beta/ }).click()
  await expect(voter.getByText(/Answer saved/)).toBeVisible()

  await expect(async () => {
    const run = await (await request.get(`/api/live/${sessionCode}/state`)).json()
    expect(run.data.slides[0].tally.total).toBe(1)
  }).toPass({ timeout: 10000 })
  const deckState = await (await request.get(`/api/live/${deck.code}/state`)).json()
  expect(deckState.data.slides[0].tally.total).toBe(0)
  await page.screenshot({ path: '/tmp/session-present.png' })
  await voter.context().close()
  await ctx.close()
})
