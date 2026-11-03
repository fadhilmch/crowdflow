import { expect, test } from '@playwright/test'
import { createDeck, poll } from './helpers'

test.skip(process.env.E2E_SESSIONS !== 'true', 'needs E2E_SESSIONS=true')

test('end, archive and delete a session from the report page', async ({ browser, request }) => {
  const deck = await createDeck(request, 'E2E session manage', [poll('Pick one', ['Alpha', 'Beta'])])
  const run = (await (await request.post(`/api/presentations/${deck.id}/sessions`, { headers: { authorization: `Bearer ${deck.token}` } })).json()).data
  const ctx = await browser.newContext({ viewport: { width: 700, height: 900 } })
  await ctx.addInitScript((token) => { localStorage.setItem('livepoll.token', token); localStorage.setItem('livepoll.user', JSON.stringify({ id: 'e2e', username: 'e2e' })) }, deck.token)
  const page = await ctx.newPage()
  await page.goto(`/report/${deck.id}`)
  const item = page.locator('li', { hasText: `code ${run.code}` })
  await expect(item).toContainText('active')
  await expect(item.getByRole('button', { name: 'Delete' })).toHaveCount(0) // not while running
  await item.getByRole('button', { name: 'End' }).click()
  await page.getByRole('dialog', {name:'End this session?'}).getByRole('button', {name:'End session',exact:true}).click()
  await expect(item).toContainText('ended')
  await item.getByRole('button', { name: 'Archive' }).click()
  await expect(item).toContainText('archived')
  await page.screenshot({ path: '/tmp/session-manage.png' })
  await item.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('dialog', { name: 'Delete this session?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('li', { hasText: `code ${run.code}` })).toHaveCount(0)
  await ctx.close()
})
