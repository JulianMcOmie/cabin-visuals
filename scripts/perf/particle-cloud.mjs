// CPU-only particle-text benchmark: node --import tsx scripts/perf/particle-cloud.mjs
// Import the registry first to satisfy instrumentFrame's existing registry cycle.
import '../../src/editor/instruments/index.ts'
import { createParticleCloud, updateParticleCloud, disposeParticleCloud, MAX_PARTICLES } from '../../src/editor/instruments/particleWordCloud.ts'
const handles = createParticleCloud()
const a = Float32Array.from({ length: MAX_PARTICLES * 3 }, (_, i) => Math.sin(i))
const b = Float32Array.from(a, (v) => -v)
const frame = { count: 8000, dotSize: 0.025, glow: 0.5, opaque: false, color: '#65aaff', variation: 0.4, prevTargets: a, curTargets: b, progress: 0.5, morphSeed: 14, stagger: 0.8, pulseScale: 1, stackComp: 0.01 }
for (let i = 0; i < 50; i++) updateParticleCloud(handles, frame)
for (const count of [8000, MAX_PARTICLES]) {
  for (const animatedColor of [false, true]) {
    const times = []
    for (let run = 0; run < 5; run++) {
      const start = performance.now()
      for (let i = 0; i < 300; i++) updateParticleCloud(handles, { ...frame, count, progress: (i % 60) / 60, color: animatedColor ? ['#65aaff', '#ff65aa'][i % 2] : frame.color })
      times.push((performance.now() - start) / 300)
    }
    times.sort((a, b) => a - b)
    console.log(JSON.stringify({ count, animatedColor, medianMsPerFrame: +times[2].toFixed(3) }))
  }
}
disposeParticleCloud(handles)
