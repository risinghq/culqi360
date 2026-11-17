export function computeNeededHolds(
  activeHolds: number,
  bufferTarget: number,
): number {
  return Math.max(0, bufferTarget - activeHolds);
}
