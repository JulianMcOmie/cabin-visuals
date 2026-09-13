const { chromium } = require(process.cwd() + '/node_modules/playwright');
const fs = require('fs');
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 let separationRequests=0;
 await page.route('**/api/drum-stem',route=>{ separationRequests++; return route.fulfill({json:{url:'http://localhost:3291/templates/promo/music.mp3'}}); });
 await page.goto('http://localhost:3291/editor',{timeout:120000});
 await page.waitForFunction(()=>!!window.__cabinStores,{timeout:120000});
 await page.evaluate(()=>{
   const s=window.__cabinStores.project.getState();
   s.addTrack({id:'text-test',name:'Lyrics control',type:'base',instrumentId:'textDisplay',color:'#fff',muted:false,solo:false,childIds:[],blocks:[],params:{},stringParams:{text:'Keep these words'}});
   window.__cabinStores.ui.getState().setSelectedTrackId('text-test');
 });
 await page.locator('[data-testid="text-display-user-interface"]').waitFor();
 if(await page.getByRole('button',{name:'Get kick MIDI',exact:true}).count()) throw new Error('Drum controls remain on Text Display');
 await page.evaluate(()=>{
   window.__cabinStores.project.getState().addTrack({id:'empty-audio',name:'Empty audio',type:'audio',instrumentId:'audio',color:'#fff',muted:false,solo:false,blocks:[],childIds:[],audioBlocks:[]});
   window.__cabinStores.ui.getState().setSelectedTrackId('empty-audio');
 });
 const kick=page.getByRole('button',{name:'Get kick MIDI',exact:true});
 await kick.waitFor({state:'visible'});
 if(!await kick.isDisabled()) throw new Error('Missing-song button should be disabled');
 await page.evaluate(()=>{
   const s=window.__cabinStores.project.getState(); s.setBpm(120);
   s.addTrack({id:'song-test',name:'Promo full mix diagnostic',type:'audio',instrumentId:'audio',color:'#fff',muted:false,solo:false,blocks:[],childIds:[],audioBlocks:[{id:'song-test',clipRef:'smoke/project/real-song',startBar:1,trimStart:1.25,trimEnd:30}]});
   window.__cabinStores.ui.getState().setSelectedTrackId('song-test');
 });
 const before=await page.evaluate(()=>JSON.stringify(window.__cabinStores.project.getState().tracks['text-test']));
 for (const label of ['kick','snare','hi-hat']) {
   await page.getByRole('button',{name:`Get ${label} MIDI`,exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('[aria-label="Extract drum MIDI"] [role="status"]')?.textContent?.startsWith('Added'),{},{timeout:120000});
 }
 const result=await page.evaluate(()=>{
   const s=window.__cabinStores.project.getState();
   return {bpm:s.bpm,beatsPerBar:s.beatsPerBar,textTrack:JSON.stringify(s.tracks['text-test']),tracks:Object.values(s.tracks).filter(t=>t.drumMidi).map(t=>({name:t.name,notes:t.blocks.flatMap(b=>b.notes.map(n=>({pitch:n.pitch,time:1.25+((b.startBar*4+n.startBeat)-4)/2,velocity:n.velocity})))}))};
 });
 if(before!==result.textTrack) throw new Error('Lyrics changed');
 if(result.tracks.length!==3||separationRequests!==1) throw new Error('Track count/cache failed');
 for(const t of result.tracks) for(const n of t.notes) if(n.time<1.25||n.time>=30) throw new Error('Trim alignment failed');
 delete result.textTrack;
 result.separationRequests=separationRequests; result.pageErrors=errors;
 result.validation='Real 32-second bundled promo song, unseparated full mix substituted ONLY at the provider response; actual browser MP3 decoding, production worker detector, UI and store import. This is not live stem separation or a transcription-accuracy benchmark.';
 fs.writeFileSync('artifacts/drum-midi/real-song-browser.json',JSON.stringify(result,null,2));
 await page.locator('[aria-label="Audio transcription"]').screenshot({path:'artifacts/drum-midi/controls.png'});
 console.log(JSON.stringify({counts:result.tracks.map(t=>({part:t.name,hits:t.notes.length,first:t.notes[0]?.time,last:t.notes.at(-1)?.time})),separationRequests,errors}));
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
