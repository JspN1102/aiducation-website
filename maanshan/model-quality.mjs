// Retina detail with a bounded drawing buffer. All viewers render on demand.
export function modelPixelRatio(width, height, deviceRatio = globalThis.devicePixelRatio || 1) {
  const area = Math.max(1, width * height);
  return Math.min(Math.max(1, Number(deviceRatio) || 1), 2, Math.max(1, Math.sqrt(2400000 / area)));
}
