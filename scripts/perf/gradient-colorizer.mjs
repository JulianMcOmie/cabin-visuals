import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']})
let page
try {
 page=await browser.newPage({viewport:{width:1600,height:1000}})
 const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE ERROR',String(e))})
 page.setDefaultTimeout(60000)
 await page.route(/supabase\.co\/(rest|auth|storage)/,r=>r.abort())
 await page.goto('http://localhost:3191/editor',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>!!window.__cabinStores&&!!window.__three)
 await page.waitForTimeout(2000)
 await page.evaluate(()=>{
  const store=window.__cabinStores.project,p=store.getState()
  const common={color:'#ff2200',muted:false,solo:false,blocks:[]}
  const tracks={base:{...common,id:'base',name:'Cube',type:'base',instrumentId:'cube',childIds:['gradient'],params:{size:1}},gradient:{...common,id:'gradient',name:'Gradient',type:'mover',moverId:'gradient',parentId:'base',childIds:[],inputValues:{mode:4},stringParams:{}}}
  const rootTrackIds=['base']
  store.setState({tracks,rootTrackIds,scenes:{...p.scenes,[p.activeSceneId]:{...p.scenes[p.activeSceneId],tracks,rootTrackIds,isMain:false}}})
  window.__cabinStores.ui.setState({selectedTrackId:'gradient',selectedTrackIds:new Set(['gradient']),canvasView:'scene'})
 })
 await page.getByLabel('Color by',{exact:true}).waitFor()
 console.log('Panel loaded',await page.getByLabel('Color by',{exact:true}).inputValue())
 await page.getByRole('button',{name:'Edit on stage',exact:true}).click()
 const svg=page.getByLabel('Gradient path stage editor')
 await svg.waitFor()
 assert.equal(await svg.locator('circle').count(),6)
 // Insert a point and edit its numeric depth.
 await page.getByRole('button',{name:'Add point',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Gradient path stage editor"] circle').length===9)
 await page.getByLabel('point Z',{exact:true}).fill('1.5')
 await page.getByLabel('point Z',{exact:true}).press('Tab')
 assert.equal(await page.evaluate(()=>JSON.parse(window.__cabinStores.project.getState().tracks.gradient.stringParams.path)[1].point[2]),1.5)
 // Drag the middle anchor in stage space, including multiple updates during capture.
 const anchor=svg.locator('circle').nth(5)
 const rect=await anchor.boundingBox()
 const before=await page.evaluate(()=>window.__cabinStores.project.getState().tracks.gradient.stringParams.path)
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2)
 await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+45,rect.y+rect.height/2+30,{steps:6});await page.mouse.up()
 assert.notEqual(await page.evaluate(()=>window.__cabinStores.project.getState().tracks.gradient.stringParams.path),before)
 await page.screenshot({path:'/tmp/gradient-colorizer.png'})
 await page.getByRole('button',{name:'Done editing on stage',exact:true}).click()
 await svg.waitFor({state:'detached'})
 await page.getByLabel('Color by',{exact:true}).selectOption('2')
 await page.getByLabel('Near Z',{exact:true}).first().waitFor()
 await page.getByLabel('Color by',{exact:true}).selectOption('3')
 await page.getByRole('radio',{name:/Distance from/i}).click()
 assert.equal(await page.evaluate(()=>window.__cabinStores.project.getState().tracks.gradient.inputValues.mapping),1)
 assert.deepEqual(errors,[])
 console.log('PASS: mode changes, point insertion, XYZ edits, stage dragging, overlay cleanup; no runtime errors')
} catch(error) { if(page) { await page.screenshot({path:'/tmp/gradient-failure.png'}); console.log((await page.locator('body').innerText()).slice(-5000)) };throw error } finally {await browser.close()}
