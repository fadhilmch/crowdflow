import { expect, test } from '@playwright/test'
import { createDeck, joinAudience, poll } from './helpers'

test.skip(process.env.E2E_SESSIONS !== 'true', 'needs E2E_SESSIONS=true')

test('each run has its own report, and an ended run is frozen', async ({ browser, request }) => {
  const deck = await createDeck(request, 'E2E session report', [poll('Pick one', ['Alpha', 'Beta'])])
  const auth = { authorization: `Bearer ${deck.token}` }
  const start = async () => (await (await request.post(`/api/presentations/${deck.id}/sessions`, { headers: auth })).json()).data
  const run1 = await start()
  const voter = await joinAudience(browser, run1.code)
  await voter.getByRole('button', { name: /Beta/ }).click()
  await expect(voter.getByText(/Answer saved/)).toBeVisible()
  await request.post(`/api/sessions/${run1.id}/end`, { headers: auth })
  await start() // a second, empty run

  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  await ctx.addInitScript((token) => { localStorage.setItem('livepoll.token', token); localStorage.setItem('livepoll.user', JSON.stringify({ id: 'e2e', username: 'e2e' })) }, deck.token)
  const page = await ctx.newPage()
  await page.goto(`/report/${deck.id}`)
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  await page.getByRole('link', { name: new RegExp(`code ${run1.code}`) }).click()
  await expect(page.getByText(/final \(ended/)).toBeVisible()
  await expect(page.locator('tr', { hasText: 'Beta' })).toContainText('100%')
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/session-report.png' })
  await voter.context().close()
  await ctx.close()
})
