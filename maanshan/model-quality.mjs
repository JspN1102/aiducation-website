// Retina detail with a bounded drawing buffer. All viewers render on demand.
// maxPixels is the device-pixel budget and maxRatio the highest pixel ratio;
// the 2.4 MP / 2x defaults are what the living field and mountain games were
// tuned with. Callers may pass their own limits.
export function modelPixelRatio(width, height, deviceRatio = globalThis.devicePixelRatio || 1, maxPixels = 2400000, maxRatio = 2) {
  const area = Math.max(1, width * height);
  return Math.min(Math.max(1, Number(deviceRatio) || 1), Math.max(1, Number(maxRatio) || 2), Math.max(1, Math.sqrt((Number(maxPixels) || 2400000) / area)));
}
