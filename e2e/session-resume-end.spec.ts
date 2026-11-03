import {expect,test} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {createDeck, poll, closeAudiences, joinAudience} from './helpers'
test.afterEach(closeAudiences)
for (const width of [390,1280]) for (const mode of ['light','dark']) {
  test(`resume run and safe End ${width} ${mode}`,async({page,request,browser},info)=>{
    const deck=await createDeck(request,`Resume ${width} ${mode}`,[poll('Keep these answers?',['Yes','No']),poll('Next slide?',['A','B'])])
    const auth={authorization:`Bearer ${deck.token}`}
    const run=(await(await request.post(`/api/presentations/${deck.id}/sessions`,{headers:auth})).json()).data
    const second=(await(await request.post(`/api/presentations/${deck.id}/sessions`,{headers:auth})).json()).data
    const audience=await joinAudience(browser,run.code)
    await audience.getByRole('button',{name:'Yes',exact:true}).click()
    await expect(audience.getByRole('region',{name:'Room results'})).toContainText('1 vote')
    await page.setViewportSize({width,height:844})
    await page.addInitScript(({token,mode})=>{localStorage.setItem('livepoll.token',token);localStorage.setItem('livepoll.user',JSON.stringify({id:'e2e',username:'e2e'}));localStorage.setItem('crowdflow.colorMode',mode)}, {token:deck.token,mode})
    let newRuns=0
    page.on('request',r=>{if(r.method()==='POST'&&/\/sessions$/.test(r.url()))newRuns++})
    await page.goto('/dashboard')
    const card=page.locator('.presentation-card',{hasText:deck.code})
    await expect(card.getByRole('link',{name:`Resume session ${run.code}`,exact:true})).toBeVisible()
    await expect(card.getByRole('link',{name:`Resume session ${second.code}`,exact:true})).toBeVisible()
    await card.scrollIntoViewIfNeeded()
    await card.screenshot({path:info.outputPath(`resume-card-${width}-${mode}.png`)})
    await card.getByRole('link',{name:`Resume session ${run.code}`,exact:true}).click()
    await expect(page).toHaveURL(`/present/${run.code}`)
    await expect(page.locator('.result-row').first()).toContainText('100%')
    await page.getByRole('button',{name:'End',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'End this presentation?'})
    await expect(dialog).toContainText('cannot be resumed')
    await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
    for(const key of ['Tab','Tab','Shift+Tab','Shift+Tab']){await page.keyboard.press(key);expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBeTruthy()}
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
    expect(axe.violations.map(v=>v.id)).toEqual([])
    await page.screenshot({path:info.outputPath(`end-dialog-${width}-${mode}.png`)})
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button',{name:'End',exact:true})).toBeFocused()
    await expect(audience.getByRole('button',{name:'Yes',exact:true})).toBeEnabled()
    await page.getByRole('button',{name:'Close voting',exact:true}).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(audience.getByRole('button',{name:'Yes',exact:true})).toBeDisabled()
    await page.getByRole('button',{name:'Reopen voting',exact:true}).click()
    await page.goto(`/report/${deck.id}`)
    const item=page.getByRole('region',{name:'Sessions'}).locator('li',{hasText:`code ${run.code}`})
    await item.getByRole('link',{name:`Resume session ${run.code}`,exact:true}).click()
    await expect(page).toHaveURL(`/present/${run.code}`)
    expect(newRuns).toBe(0)
    await page.getByRole('button',{name:'End',exact:true}).click()
    await dialog.getByRole('button',{name:'End presentation',exact:true}).click()
    await expect(page).toHaveURL(`/report/session/${run.id}`)
    await expect(page.getByTestId('report')).toBeVisible()
    await page.screenshot({path:info.outputPath(`finished-report-${width}-${mode}.png`)})
    await expect(audience.getByRole('heading',{name:'Thanks for taking part!'})).toBeVisible()
    await expect(page.getByRole('link',{name:`Resume session ${run.code}`,exact:true})).toHaveCount(0)
    await page.goto(`/report/${deck.id}`)
    await expect(page.getByRole('link',{name:`Resume session ${second.code}`,exact:true})).toBeVisible()
    await page.goto(`/report/session/${run.id}`)
    await expect(page.getByTestId('report').locator('tr').filter({hasText:'Yes'})).toContainText('100%')
    // The report End entry point also waits for confirmation and survives Cancel.
    await page.goto(`/report/${deck.id}`)
    const active=page.getByRole('region',{name:'Sessions'}).locator('li',{hasText:`code ${second.code}`})
    await active.getByRole('button',{name:'End',exact:true}).click()
    const reportDialog=page.getByRole('dialog',{name:'End this session?'})
    await reportDialog.getByRole('button',{name:'Cancel',exact:true}).click()
    await expect(active).toContainText('active')
    await active.getByRole('button',{name:'End',exact:true}).click()
    await reportDialog.getByRole('button',{name:'End session',exact:true}).click()
    await expect(active).toContainText('ended')
    await expect(active.getByRole('link',{name:/Resume/})).toHaveCount(0)
  })
}

test('End failure stays in the dialog and can be retried once; reusable runs explain restart',async({page,request})=>{
  const deck=await createDeck(request,'Reusable End',[poll('Keep?', ['A','B'])])
  await page.addInitScript(token=>{localStorage.setItem('livepoll.token',token);localStorage.setItem('livepoll.user',JSON.stringify({id:'e2e',username:'e2e'}))},deck.token)
  await page.goto(`/present/${deck.code}`)
  await expect(page.getByRole('button',{name:'End',exact:true})).toBeVisible()
  let endCalls=0
  let fail=true
  await page.route('**/live-actions',async route=>{
    if(route.request().postDataJSON()?.type==='presentation:end'){
      endCalls++
      if(fail){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary test failure. Try again.'})});return}
    }
    await route.continue()
  })
  await page.getByRole('button',{name:'End',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'End this presentation?'})
  await expect(dialog).toContainText('same code and existing answers')
  await dialog.getByRole('button',{name:'End presentation',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Temporary test failure')
  await expect(page).toHaveURL(`/present/${deck.code}`)
  fail=false
  await dialog.getByRole('button',{name:'End presentation',exact:true}).click()
  await expect(page).toHaveURL(`/report/${deck.id}`)
  expect(endCalls).toBe(2)
})
