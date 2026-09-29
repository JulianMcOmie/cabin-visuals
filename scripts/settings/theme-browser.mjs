/** Real provider + picker + CSS in Chromium with a deterministic auth/session boundary.
 * Run: node scripts/settings/theme-browser.mjs. No credentials or database writes.
 */
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { readFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = process.cwd()
const css = (await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: path.join(root, 'app/globals.css') })).css
const bundle = await build({
  stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ThemeProvider} from './src/settings/ThemeProvider';
    import {ThemePicker} from './src/settings/ThemePicker';
    createRoot(document.getElementById('root')).render(<ThemeProvider><main><ThemePicker/><div className="editorial-skin" id="editorial">Editorial page</div><div className="timeline-glass-scope" id="timeline">Timeline</div><div id="authored" style={{color:'#ff00aa'}}>Authored color</div></main></ThemeProvider>);
  `, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'auth-fixture', setup(build) {
    build.onResolve({ filter: /persistence\/hooks\/useAuth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      import {useSyncExternalStore} from 'react';
      let auth = {user:null, loading:false, isAnonymous:false}; const listeners = new Set();
      window.setAuth = user => {auth={user,loading:false,isAnonymous:!!user?.is_anonymous}; listeners.forEach(l=>l());};
      export function useAuth(){return useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l)},()=>auth)}
    `, loader: 'js', resolveDir: root }))
  } }],
})
const browser = await chromium.launch({ headless: true })
try {
 const page = await browser.newPage({ viewport: { width: 1000, height: 850 } })
 const errors = []
 page.on('pageerror', e => errors.push(e.message))
 let mode = 'success'; let pending; const requests=[]
 await page.route('http://theme.test/**', async route => {
  if (route.request().url().endsWith('/api/settings')) {
   requests.push(route.request().postDataJSON())
   if (mode === 'pending') { pending = route; return }
   await route.fulfill({status:mode==='fail'?503:200, contentType:'application/json', body:'{}'})
  } else await route.fulfill({contentType:'text/html', body:`<html><head><meta name="theme-color" content="#0c0d12"><style>${css}</style></head><body><div id="root" style="max-width:640px;margin:auto"></div><script>${bundle.outputFiles[0].text}</script></body></html>`})
 })
 await page.goto('http://theme.test/account')
 const theme = expected => page.waitForFunction(t=>document.documentElement.dataset.theme===t, expected)
 const user = (id, themeId) => ({id, user_metadata:{cabin_settings:{theme:themeId}}})
 await page.getByRole('radio', {name:/Forest/}).check(); await theme('forest')
 await page.reload(); await theme('forest')
 // Login never inherits guest or previous account colors.
 await page.evaluate(u=>window.setAuth(u),user('a','violet')); await theme('violet')
 await page.getByRole('radio',{name:/Ember/}).check()
 await page.getByRole('status').filter({hasText:'Theme saved to your account.'}).waitFor()
 assert.deepEqual(requests.at(-1),{userId:'a',theme:'ember'})
 assert.equal(await page.evaluate(()=>localStorage.getItem('cabin:settings:v1:a')),'ember')
 mode='fail'; await page.getByRole('radio',{name:/Graphite/}).check()
 await page.getByRole('button',{name:'Retry saving'}).waitFor(); await theme('graphite')
 assert.equal(await page.evaluate(()=>localStorage.getItem('cabin:settings:v1:a')),'ember','failed saves must not claim persistence')
 mode='success'; await page.getByRole('button',{name:'Retry saving'}).click()
 await page.getByRole('status').filter({hasText:'Theme saved to your account.'}).waitFor()
 // A pending request belongs only to the account that started it.
 mode='pending'; await page.getByRole('radio',{name:/Forest/}).check()
 await page.waitForFunction(()=>document.querySelector('fieldset').disabled)
 await page.evaluate(u=>window.setAuth(u),user('b','midnight')); await theme('midnight')
 await pending.fulfill({status:200,contentType:'application/json',body:'{}'})
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'midnight')
 assert.equal(await page.evaluate(()=>localStorage.getItem('cabin:settings:v1:b')),null)
 await page.evaluate(u=>window.setAuth(u),user('a','graphite')); await theme('graphite')
 await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'cabin:settings:v1:b',newValue:'ember'})))
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'graphite')
 await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'cabin:settings:v1:a',newValue:'violet'})))
 await theme('violet')
 await page.evaluate(()=>window.setAuth(null)); await theme('forest')
 // Validate palette inheritance including editorial wrappers, nested scope, and body portals.
 for(const id of ['midnight','forest','ember','violet','graphite']) {
  await page.getByRole('radio',{name:new RegExp(id,'i')}).check(); await theme(id)
  const values=await page.evaluate(()=>{
   const root=getComputedStyle(document.documentElement), skin=getComputedStyle(document.getElementById('editorial'))
   const portal=document.createElement('div');portal.style.background='var(--bg-panel)';document.body.append(portal)
   const result={background:root.getPropertyValue('--bg-page').trim(),accent:root.getPropertyValue('--accent').trim(),skin:skin.backgroundColor,portal:getComputedStyle(portal).backgroundColor,authored:getComputedStyle(document.getElementById('authored')).color, meta:document.querySelector('meta[name="theme-color"]').content};portal.remove();return result
  })
  assert.equal(values.meta,values.background)
  assert.notEqual(values.skin,'rgba(0, 0, 0, 0)');assert.notEqual(values.portal,'rgba(0, 0, 0, 0)')
  assert.equal(values.authored,'rgb(255, 0, 170)')
  console.log(id,JSON.stringify(values))
 }
 // Keyboard-accessible radio group.
 await page.getByRole('radio',{name:/Graphite/}).focus(); await page.keyboard.press('ArrowLeft');await theme('violet')
 await mkdir('artifacts/themes',{recursive:true});await page.screenshot({path:'artifacts/themes/settings-violet.png'})
 assert.deepEqual(errors,[])
 console.log('PASS: guest reload; account isolation; successful save; failure/retry; pending account switch; all palettes and portals; authored color isolation; keyboard selection.')
} finally { await browser.close() }
