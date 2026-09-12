/**
 * Top-down projection. World space and screen space are the same plane, so
 * "screen" here is just world coordinates before the camera transform.
 * Characters are still drawn upright (classic 3/4 top-down JRPG look) --
 * the ground is flat, the actors are not.
 */
export const TS = 48; // world px per tile

export function toScreen(wx: number, wy: number): [number, number] {
  return [wx, wy];
}

export function toWorld(sx: number, sy: number): [number, number] {
  return [sx, sy];
}

/** Draw order: things lower on the screen are in front. */
export function depth(_wx: number, wy: number): number {
  return wy;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, w / 2 - cam.x * cam.zoom, h / 2 - cam.y * cam.zoom);
}

/** Keep the camera inside the map; centre it when the map is smaller than the screen. */
export function clampCamera(cam: Camera, worldW: number, worldH: number, w: number, h: number): void {
  const hw = w / 2 / cam.zoom;
  const hh = h / 2 / cam.zoom;
  cam.x = worldW <= hw * 2 ? worldW / 2 : Math.max(hw, Math.min(worldW - hw, cam.x));
  cam.y = worldH <= hh * 2 ? worldH / 2 : Math.max(hh, Math.min(worldH - hh, cam.y));
}

export function screenToWorldPoint(cam: Camera, w: number, h: number, px: number, py: number): [number, number] {
  return [(px - w / 2) / cam.zoom + cam.x, (py - h / 2) / cam.zoom + cam.y];
}

/** Visible world rectangle, for culling. */
export function viewBounds(cam: Camera, w: number, h: number, pad = 96):
  { x0: number; y0: number; x1: number; y1: number } {
  const hw = w / 2 / cam.zoom + pad;
  const hh = h / 2 / cam.zoom + pad;
  return { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh };
}

export function tilePath(ctx: CanvasRenderingContext2D, wx: number, wy: number, size = TS): void {
  ctx.beginPath();
  ctx.rect(wx, wy, size, size);
}

export function shadow(ctx: CanvasRenderingContext2D, wx: number, wy: number, r: number, alpha = 0.25): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(wx, wy, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
