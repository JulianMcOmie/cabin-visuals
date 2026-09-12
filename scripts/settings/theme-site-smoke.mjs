import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const base=process.env.THEME_TEST_URL || 'http://127.0.0.1:3337'
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/account',{waitUntil:'domcontentloaded'})
 await page.getByRole('radio',{name:/Forest/}).check({timeout:90000})
 await page.getByRole('status').filter({hasText:'Saved in this browser'}).waitFor()
 await mkdir('artifacts/themes',{recursive:true})
 await page.screenshot({path:'artifacts/themes/account-forest.png',fullPage:true})
 for(const route of ['/pricing','/login','/projects','/','/editor']) {
  await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='forest',null,{timeout:90000})
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(9, 19, 16)')
  console.log('PASS',route,'restores Forest')
 }
 await page.locator('[data-workspace-card]').waitFor({timeout:120000})
 await page.screenshot({path:'artifacts/themes/editor-forest.png'})
 assert.deepEqual(errors,[])
 console.log('PASS: real routes compile, restore theme on navigation/reload, and raise no page errors')
} finally {await browser.close()}
