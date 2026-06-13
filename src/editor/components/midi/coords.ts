// Coordinate conversions between the three spaces the midi editor deals with:
// viewport pixels (clientX/Y) -> grid-local pixels -> musical units (beats, rows)

export function clientToGrid(clientX: number, clientY: number, gridRect: DOMRect) {
  return { x: clientX - gridRect.left, y: clientY - gridRect.top }
}

export function xToBeat(x: number, pixelsPerBeat: number) {
  return x / pixelsPerBeat
}

export function yToRowIndex(y: number, rowHeight: number) {
  return Math.floor(y / rowHeight)
}

export function beatToX(beat: number, pixelsPerBeat: number) {
  return beat * pixelsPerBeat
}

export function rowIndexToY(rowIndex: number, rowHeight: number) {
  return rowIndex * rowHeight
}
