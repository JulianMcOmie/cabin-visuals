'use client'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { buildGradientPath, parseGradientPath, type PathPoint } from '../../core/visualCopies/gradientPath'
import { moveGradientHandle, splitGradientSegment, useGradientEditing, type HandleKind } from '../../userInterfaceRenderers/gradientEditing'
import { gradientStops } from '../../utils/oklch'

/** DOM overlay: editor handles never enter the rendered scene or exported video. */
export function GradientStageEditor() {
  const session=useGradientEditing(s=>s.session)
  return session ? <StagePath session={session}/> : null
}
function StagePath({session}:{session:NonNullable<ReturnType<typeof useGradientEditing.getState>['session']>}) {
  const {camera,size,gl}=useThree()
  const nodes=useMemo(()=>parseGradientPath(session.raw),[session.raw])
  const path=useMemo(()=>buildGradientPath(session.raw,session.curved),[session.raw,session.curved])
  const [revision,setRevision]=useState(0)
  const cameraKey=useRef('')
  useFrame(()=>{const key=camera.matrixWorld.elements.join(',')+camera.projectionMatrix.elements.join(',');if(key!==cameraKey.current){cameraKey.current=key;setRevision(v=>v+1)}})
  const project=(p:PathPoint)=>{const v=new Vector3(...p).project(camera);return [(v.x+1)*size.width/2,(1-v.y)*size.height/2,v.z]}
  const drag=useRef<{index:number;kind:HandleKind;z:number}|null>(null)
  function move(e:PointerEvent<SVGSVGElement>) {
    if(!drag.current)return
    const rect=gl.domElement.getBoundingClientRect()
    const ray=new Raycaster();ray.setFromCamera(new Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera)
    const hit=ray.ray.intersectPlane(new Plane(new Vector3(0,0,1),-drag.current.z),new Vector3())
    if(hit && [hit.x,hit.y,hit.z].every(v=>Number.isFinite(v)&&Math.abs(v)<=10000)) session.set(JSON.stringify(moveGradientHandle(nodes,drag.current.index,drag.current.kind,hit.toArray() as PathPoint)))
  }
  const points=path.points.map(project)
  const colors=gradientStops(session.colorA,session.colorB,65)
  return <Html fullscreen calculatePosition={() => [size.width / 2, size.height / 2]} style={{pointerEvents:'none'}} zIndexRange={[40,30]}><svg data-camera-revision={revision} aria-label="Gradient path stage editor" width={size.width} height={size.height} style={{pointerEvents:'none',touchAction:'none'}} onPointerMove={move} onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>{drag.current=null}}>
    {points.slice(1).map((p,i)=>p[2]<-1||p[2]>1||points[i][2]<-1||points[i][2]>1?null:<g key={i}>
      <line x1={points[i][0]} y1={points[i][1]} x2={p[0]} y2={p[1]} stroke={colors[Math.round(path.total > 1e-8 ? path.lengths[i] / path.total * 64 : 32)]} strokeWidth={3}/>
      {session.curved && <line x1={points[i][0]} y1={points[i][1]} x2={p[0]} y2={p[1]} stroke="transparent" strokeWidth={14} style={{pointerEvents:'stroke',cursor:'copy'}} onPointerDown={e=>{e.stopPropagation();session.set(JSON.stringify(splitGradientSegment(nodes,Math.floor(i/64),((i%64)+0.5)/64)))}}/>}
    </g>)}
    {nodes.map((node,index)=>{
      if(!session.curved && index!==0 && index!==nodes.length-1)return null
      const p=project(node.point)
      return <g key={index}>{(session.curved?['incoming','outgoing','point']:['point']).map(key=>{
        const kind=key as HandleKind,q=project(node[kind]);if(q[2]<-1||q[2]>1)return null
        return <g key={kind}>{kind!=='point'&&<line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="white" strokeOpacity={0.5} strokeDasharray="3 3"/>}<circle cx={q[0]} cy={q[1]} r={kind==='point'?7:5} fill={kind==='point'?'white':'#27272a'} stroke="white" strokeWidth={2} style={{pointerEvents:'all',cursor:'grab'}} onPointerDown={e=>{e.stopPropagation();drag.current={index,kind,z:node[kind][2]};e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId)}}><title>{`Point ${index+1} ${kind}`}</title></circle></g>
      })}<text x={p[0]+10} y={p[1]-10} fill="white" fontSize={11}>{index===0?'A':index===nodes.length-1?'B':index+1}</text></g>
    })}
  </svg></Html>
}
