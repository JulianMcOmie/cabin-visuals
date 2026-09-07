'use client'
import { useEffect, useState } from 'react'
import { useUIStore } from '../store/UIStore'
import { parseGradientPath, type PathPoint } from '../core/visualCopies/gradientPath'
import { moveGradientHandle, splitGradientSegment, useGradientEditing, type HandleKind } from './gradientEditing'
import type { UserInterfaceParameter } from './types'
export function GradientPathEditor({ targetId, bound, curved, colorA, colorB }: { targetId: string; bound: UserInterfaceParameter; curved: boolean; colorA: string; colorB: string }) {
  const [editing,setEditing]=useState(false)
  const [selected,setSelected]=useState(0)
  const nodes=parseGradientPath(String(bound.value))
  const index=curved ? Math.min(selected,nodes.length-1) : selected === 0 ? 0 : nodes.length-1
  useEffect(() => {
    if (!editing) return
    useGradientEditing.getState().setSession({targetId,raw:String(bound.value),curved,colorA,colorB,set:bound.setValue})
    return () => { if(useGradientEditing.getState().session?.targetId===targetId) useGradientEditing.getState().setSession(null) }
  },[editing,targetId,bound.value,bound.setValue,curved,colorA,colorB])
  return <div className="space-y-2 text-xs">
    <button className="rounded border border-white/20 px-2 py-1" aria-pressed={editing} onClick={()=>{ if(!editing) useUIStore.getState().setCanvasView('scene'); setEditing(!editing) }}>{editing?'Done editing on stage':'Edit on stage'}</button>
    <p className="text-white/50">World coordinates. Drag handles in XY; set Z below.{curved?' Click the stage path to add a point.':''}</p>
    <div className="flex gap-2">
      <select aria-label="Path point" value={index} onChange={e=>setSelected(Number(e.target.value))} className="bg-zinc-900">
        {nodes.map((_,i)=> (!curved && i!==0 && i!==nodes.length-1)?null:<option key={i} value={i}>{i===0?'Start':i===nodes.length-1?'End':`Point ${i+1}`}</option>)}
      </select>
      {curved && <><button disabled={nodes.length>=64} onClick={()=>{ const i=Math.min(index,nodes.length-2); bound.setValue(JSON.stringify(splitGradientSegment(nodes,i))); setSelected(i+1) }}>Add point</button><button disabled={nodes.length<=2} onClick={()=>{bound.setValue(JSON.stringify(nodes.filter((_,i)=>i!==index)));setSelected(Math.max(0,index-1))}}>Delete point</button></>}
    </div>
    {(curved?['point','incoming','outgoing']:['point']).map(key=>{
      const kind=key as HandleKind
      return <div key={kind} className="flex items-center gap-1"><span className="w-16 text-white/60">{kind}</span>{['X','Y','Z'].map((axis,k)=><label key={axis} className="min-w-0 flex-1 text-white/50">{axis}<input aria-label={`${kind} ${axis}`} type="number" step="0.1" value={Number(nodes[index][kind][k].toFixed(3))} className="w-full rounded bg-white/5 px-1 text-white" onChange={e=>{ if(e.target.value==='')return; const v=Number(e.target.value); if(!Number.isFinite(v)||Math.abs(v)>10000)return;const p=[...nodes[index][kind]] as PathPoint;p[k]=v;bound.setValue(JSON.stringify(moveGradientHandle(nodes,index,kind,p))) }}/></label>)}</div>
    })}
  </div>
}
