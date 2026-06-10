export function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function radialToCartesian(angle: number, distance: number, height: number): { x: number; y: number; z: number } {
  const rad = angle * Math.PI / 180;
  return { x: Math.sin(rad) * distance, y: height, z: Math.cos(rad) * distance };
}

export function catmullRom(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function unwrapAngle(ref: number, angle: number): number {
  let d = angle - ref;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return ref + d;
}
