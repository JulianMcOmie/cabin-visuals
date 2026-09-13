import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { applyGpuAppearance, isGpuAppearanceSupported, paletteAppearance, staggeredNoteAppearance } from './gpuAppearance'
import { colorizerPalette, evaluateColorizer, noteColorizer, type ColorizerSettings } from './colorizer'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { buildGradientPath, sampleGradientPath } from './gradientPath'
import type { ResolvedNote } from '../visual/types'

test('palette data preserves raw tint strings, invalid colors, inherited mix and zero-amount passthrough',()=>{
  const input=identityVisualCopy();input.colorShift.tint='#123456';input.colorShift.tintAmount=.4;input.colorShift.tintPerceptual=true
  const context={beat:0,index:0,count:1}
  for(const text of ['#AbCdEf','invalid','hsl(40, 80%, 50%)','']){
    const operation=paletteAppearance({mode:5},[text],.7)
    assert.ok(isGpuAppearanceSupported(operation))
    const copy=applyGpuAppearance(operation,input,context)
    assert.equal(copy.colorShift.tint,text);assert.equal(copy.colorShift.tintAmount,.7);assert.equal(copy.colorShift.tintPerceptual,true)
    assert.deepEqual(applyGpuAppearance(paletteAppearance({mode:5},[text],0),input,context).colorShift,input.colorShift)
  }
})

test('appearance records reject corrupt payload ranges and cyclic path trees',()=>{
  const operation=paletteAppearance({mode:5},['#ff0000'],1)
  assert.ok(isGpuAppearanceSupported(operation))
  assert.equal(isGpuAppearanceSupported({...operation,scaleBound:2}),false)
  assert.equal(isGpuAppearanceSupported({...operation,determinantPreserving:false}),false)
  const bad=operation.parameters.slice();bad[18]=bad.length
  assert.equal(isGpuAppearanceSupported({...operation,parameters:bad}),false)
  const path=paletteAppearance({mode:8,path:buildGradientPath(undefined,true)},['#ff0000','#00ff00'],1)
  assert.ok(isGpuAppearanceSupported(path))
  const cycle=path.parameters.slice();cycle[cycle[12]+6]=0
  assert.equal(isGpuAppearanceSupported({...path,parameters:cycle}),false)
})

test('path payload retains original closest-segment mapping and rounded LUT sampling',()=>{
  const path=buildGradientPath(JSON.stringify([
    {point:[-3,-1,1],incoming:[-4,0,1],outgoing:[2,4,-2]},
    {point:[2,1,-1],incoming:[-2,-4,2],outgoing:[4,2,1]},
    {point:[4,-2,2],incoming:[3,-4,1],outgoing:[6,0,0]},
  ]),true)
  const colors=Array.from({length:65},(_,i)=>'#'+(i*2048+10).toString(16).padStart(6,'0'))
  for(const distance of [false,true]){
    const operation=paletteAppearance({mode:distance?9:8,path,span:3,clamp:true},colors,1,{rounded:true})
    assert.ok(isGpuAppearanceSupported(operation))
    for(let index=0;index<200;index++){
      const copy=identityVisualCopy(),x=Math.sin(index*1.37)*5,y=Math.cos(index*.79)*4,z=Math.sin(index*.37)*3
      copy.transform.makeTranslation(x,y,z)
      const t=Math.max(0,Math.min(1,sampleGradientPath(path,x,y,z,distance,3)))
      assert.equal(applyGpuAppearance(operation,copy,{beat:0,index,count:200}).colorShift.tint,colors[Math.round(t*64)])
    }
  }
})

test('staggered temporal data matches independent note helpers through chords, ties, unsorted notes and projective placement',()=>{
  const notes:ResolvedNote[]=[
    {beat:1,pitch:61,durationBeats:2,velocity:127,blockStartBeat:0,blockEndBeat:16},
    {beat:0,pitch:60,durationBeats:.6,velocity:.8,blockStartBeat:0,blockEndBeat:16},
    {beat:.4,pitch:62,durationBeats:1,velocity:90,blockStartBeat:0,blockEndBeat:16},
    {beat:0,pitch:61,durationBeats:3,velocity:127,blockStartBeat:0,blockEndBeat:16},
    {beat:.5,pitch:63,durationBeats:0,velocity:.5,blockStartBeat:0,blockEndBeat:16},
    {beat:.5,pitch:65,durationBeats:2,velocity:.8,blockStartBeat:0,blockEndBeat:16},
    {beat:-1,pitch:60,durationBeats:1,velocity:.4,blockStartBeat:-4,blockEndBeat:16},
  ]
  const placement=new Matrix4().makeRotationY(.4).setPosition(.2,-.3,.7);placement.elements[3]=.02;placement.elements[7]=-.01
  for(const staggerBeats of [-.5,-.1,.1,.5])for(const shape of [0,1,2,1.5]){
    const settings=mergeDefinitionSettings(noteColorizer,{staggerBeats,shape,attackBeats:.3,releaseBeats:.7}) as unknown as ColorizerSettings
    const palette=colorizerPalette(settings)
    for(const beat of [-2,0,.5,1,1.3,2.4,5,1])for(const index of [0,1,2,7,1000000]){
      const copy=identityVisualCopy();copy.transform.makeTranslation(.7,-.2,1.3);copy.colorShift.hue=.2;copy.colorShift.tint='#123456';copy.colorShift.tintAmount=.3
      const operation=staggeredNoteAppearance(settings,notes,palette,beat)
      assert.ok(isGpuAppearanceSupported(operation))
      const output=applyGpuAppearance(operation,copy,{beat,index,count:1000001,placementTransform:placement})
      const position=new Vector3().setFromMatrixPosition(copy.transform).applyMatrix4(placement)
      const expected=evaluateColorizer(notes,settings,beat,index,(position.x+position.y)*Math.SQRT1_2,palette)
      assert.ok(Math.abs(output.colorShift.hue-(copy.colorShift.hue+expected.hue))<1e-10)
      assert.equal(output.colorShift.tint,expected.tintAmount>0&&expected.tint?expected.tint:copy.colorShift.tint)
      assert.equal(output.colorShift.tintAmount,expected.tintAmount>0&&expected.tint?expected.tintAmount:copy.colorShift.tintAmount)
      assert.deepEqual(output.transform.elements,copy.transform.elements)
    }
  }
})
