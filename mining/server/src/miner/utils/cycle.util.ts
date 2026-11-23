export function computeCycleEndAt(currentTimestamp: number, cycle: number) {
  return currentTimestamp + cycle;
}

// Paid miners expire at Shanghai midnight, never later than the nominal end.
export function computePaidCycleEndAt(start: number, cycle: number) {
  return Math.floor((start + cycle + 28800) / 86400) * 86400 - 28800;
}
