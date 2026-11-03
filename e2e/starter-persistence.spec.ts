import {expect,test} from '@playwright/test'
import {login} from './helpers'
for(const kind of ['Quiz','Presentation','Blank']) test(`creation intent survives discarding unsaved ${kind} starter`,async({page,request},info)=>{
 const token=await login(request)
 await page.addInitScript(token=>{localStorage.setItem('livepoll.token',token);localStorage.setItem('livepoll.user',JSON.stringify({id:'e2e',username:'e2e'}))},token)
 page.on('dialog',d=>d.accept())
 await page.goto('/dashboard')
 await page.getByRole('button',{name:'+ New presentation'}).click()
 const modal=page.getByRole('dialog',{name:'New presentation'})
 await modal.getByRole('radio',{name:new RegExp('^'+kind+' ')}).click()
 const title=`Keep ${kind} starter`
 await modal.getByLabel('Name',{exact:true}).fill(title)
 const createdPromise=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/presentations'))
 await modal.getByRole('button',{name:'Create',exact:true}).click()
 const created=(await(await createdPromise).json()).data
 await expect(page).toHaveURL(/\/edit\//)
 const editURL=new URL(page.url()).pathname
 await expect(page.getByTestId('sorter-item')).toHaveCount(kind==='Blank'?0:1)
 await page.getByRole('link',{name:'My presentations',exact:true}).click()
 await expect(page).toHaveURL('/dashboard')
 await page.locator('.presentation-card',{hasText:title}).getByRole('link',{name:'Edit',exact:true}).click()
 await expect(page).toHaveURL(editURL)
 await expect(page.getByTestId('sorter-item')).toHaveCount(kind==='Blank'?0:1)
 if(kind!=='Blank')await expect(page.locator('.slide-type')).toContainText(kind==='Quiz'?'Quiz':'Multiple choice')
 const stored=(await(await request.get(`/api/presentations/${created._id}`,{headers:{authorization:`Bearer ${token}`}})).json()).data
 expect(stored.creationKind).toBe(kind.toLowerCase())
 expect(stored.slides).toEqual([])
 await page.screenshot({path:info.outputPath(`starter-${kind}.png`)})
})
