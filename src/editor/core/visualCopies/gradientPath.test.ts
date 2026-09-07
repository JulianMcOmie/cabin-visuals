import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGradientPath, sampleGradientPath, parseGradientPath, DEFAULT_GRADIENT_PATH } from './gradientPath'
import { splitGradientSegment, moveGradientHandle } from '../../userInterfaceRenderers/gradientEditing'

test('curve progress follows arc length across unevenly spaced anchors', () => {
  const raw=JSON.stringify([0,1,10].map(x=>({point:[x,0,0],incoming:[x,0,0],outgoing:[x,0,0]})))
  const path=buildGradientPath(raw,true)
  assert.ok(Math.abs(sampleGradientPath(path,1,0,0,false,1)-0.1)<1e-9)
  assert.ok(Math.abs(sampleGradientPath(path,5,0,0,false,1)-0.5)<1e-9)
})
test('splitting a bent 3D curve preserves its shape and length', () => {
  const nodes=parseGradientPath(DEFAULT_GRADIENT_PATH)
  nodes[0].outgoing=[-1,4,2]; nodes[1].incoming=[1,-2,1]
  const before=buildGradientPath(JSON.stringify(nodes),true)
  const after=buildGradientPath(JSON.stringify(splitGradientSegment(nodes,0)),true)
  assert.ok(Math.abs(before.total-after.total)<0.005)
  for(const point of before.points) assert.ok(sampleGradientPath(after,...point,true,1)<0.003)
})
test('moving anchors carries handles; moving a handle keeps anchor fixed',()=>{
  const nodes=parseGradientPath()
  const moved=moveGradientHandle(nodes,0,'point',[0,1,2])
  assert.deepEqual(moved[0].outgoing,[2,1,2])
  assert.deepEqual(moveGradientHandle(nodes,0,'outgoing',[9,8,7])[0].point,nodes[0].point)
})
test('malformed data and coincident points stay finite',()=>{
  assert.deepEqual(parseGradientPath('{bad'),parseGradientPath())
  assert.deepEqual(parseGradientPath('[{}]'),parseGradientPath())
  const raw=JSON.stringify([0,0].map(()=>({point:[0,0,0],incoming:[0,0,0],outgoing:[0,0,0]})))
  assert.equal(sampleGradientPath(buildGradientPath(raw,true),0,0,0,false,1),0.5)
})
