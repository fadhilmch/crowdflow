import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createDeck, joinAudience, poll, presenterAction } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
async function violations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(tags).analyze()
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)
}

test.describe('accessibility', () => {
  test('public and audience screens have no axe violations', async ({ browser, request }) => {
    const deck = await createDeck(request, 'E2E a11y', [poll('Pick one', ['Alpha', 'Beta'])])
    await presenterAction(request, deck, { type: 'slide:change', slideIndex: 0 })
    const audience = await joinAudience(browser, deck.code)
    await audience.waitForTimeout(800)
    expect(await violations(audience), 'audience').toEqual([])
    await audience.context().close()

    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
    const page = await ctx.newPage()
    await page.goto('/')
    await page.waitForTimeout(800)
    expect(await violations(page), 'landing').toEqual([])
    await page.goto('/login')
    await page.waitForTimeout(800)
    expect(await violations(page), 'login').toEqual([])
    await ctx.close()
  })

  test('owner screens have no axe violations', async ({ browser, request }) => {
    const deck = await createDeck(request, 'E2E a11y owner', [poll('Pick one', ['Alpha', 'Beta'])])
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } })
    await ctx.addInitScript((token) => { localStorage.setItem('livepoll.token', token); localStorage.setItem('livepoll.user', JSON.stringify({ id: 'e2e', username: 'e2e' })) }, deck.token)
    const page = await ctx.newPage()
    for (const path of ['/dashboard', `/edit/${deck.id}`, `/present/${deck.code}`]) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      expect(await violations(page), path).toEqual([])
    }
    await ctx.close()
  })

  test('an audience member can vote with the keyboard alone', async ({ browser, request }) => {
    const deck = await createDeck(request, 'E2E keyboard', [poll('Pick one', ['Alpha', 'Beta'])])
    await presenterAction(request, deck, { type: 'slide:change', slideIndex: 0 })
    const page = await joinAudience(browser, deck.code)
    await page.locator('body').press('Tab')
    for (let i = 0; i < 6; i += 1) {
      const label = await page.evaluate(() => document.activeElement?.textContent ?? '')
      if (/Beta/.test(label)) break
      await page.keyboard.press('Tab')
    }
    await page.keyboard.press('Space')
    await expect(page.getByText(/Answer saved/)).toBeVisible()
    await page.context().close()
  })

  test('reduced motion turns animations and transitions off', async ({ browser, request }) => {
    const deck = await createDeck(request, 'E2E motion', [poll('Pick one', ['Alpha', 'Beta'])])
    await presenterAction(request, deck, { type: 'slide:change', slideIndex: 0 })
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 800 } })
    const page = await ctx.newPage()
    await page.goto(`/p/${deck.code}`)
    await page.waitForLoadState('networkidle')
    const longest = await page.evaluate(() => {
      let max = 0
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const s = getComputedStyle(el)
        for (const d of [s.animationDuration, s.transitionDuration]) {
          for (const part of d.split(',')) max = Math.max(max, parseFloat(part) * (part.trim().endsWith('ms') ? 1 : 1000))
        }
      }
      return max
    })
    expect(longest).toBeLessThanOrEqual(10) // ms; effectively none
    await ctx.close()
  })
})
