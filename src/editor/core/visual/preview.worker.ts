// Next 15 Turbopack's worker refresh stub returns undefined from signature
// wrappers, which erases memo(function Component) exports. Install identity
// signatures in this worker BEFORE importing any React modules. Production
// builds have no refresh wrappers and never enter this branch.
if (process.env.NODE_ENV !== 'production') {
  Object.assign(globalThis, {
    $RefreshInterceptModuleExecution$: () => () => {},
    $RefreshReg$: () => {},
    $RefreshSig$: () => <T,>(type: T) => type,
  })
}
const waiting: MessageEvent[] = []
self.onmessage = event => { waiting.push(event) }
void import('./previewWorkerRuntime').then(() => {
  for (const event of waiting) self.onmessage?.call(self, event)
  waiting.length = 0
})
