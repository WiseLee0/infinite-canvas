/**
 * borrow from @see https://github.com/tldraw/tldraw/blob/324a049abe8f414f96fdcbca68bb95396b6c1a46/packages/editor/src/lib/hooks/useCursor.ts#L12
 */

import { RAD_TO_DEG } from '@pixi/math';

const CORNER_SVG = `<g><path d="M10.3496 16.8571V22M10.3496 22H15.4925M10.3496 22L22.3496 10M22.3496 15.1429V10M22.3496 10H17.2068" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.3496 16.8571V22M10.3496 22H15.4925M10.3496 22L22.3496 10M22.3496 15.1429V10M22.3496 10H17.2068" stroke="black" stroke-linecap="round" stroke-linejoin="round"/></g>`
const EDGE_SVG = `<g><path d="M21.1983 19.6376L24.8349 16.001M24.8349 16.001L21.1983 12.3645M24.8349 16.001L7.86433 16.001M11.5009 12.3645L7.86433 16.001M7.86433 16.001L11.5009 19.6376" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M21.1983 19.6376L24.8349 16.001M24.8349 16.001L21.1983 12.3645M24.8349 16.001L7.86433 16.001M11.5009 12.3645L7.86433 16.001M7.86433 16.001L11.5009 19.6376" stroke="black" stroke-linecap="round" stroke-linejoin="round"/></g>`
const ROTATE_CORNER_SVG = `<g><path d="M20.8514 9.7725L23.5 12.4212M23.5 12.4212L20.8514 15.0698M23.5 12.4212C23.5 12.4212 21.6089 12.0427 19.7162 12.4212C17.8235 12.7997 15.9443 13.7046 14.4189 15.4482C12.8936 17.1919 12.3739 19.1127 12.1486 20.7455C11.9234 22.3783 12.1486 24.5293 12.1486 24.5293M12.1486 24.5293L14.7973 21.8806M12.1486 24.5293L9.5 21.8806" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></g><path d="M20.8514 9.7725L23.5 12.4212M23.5 12.4212L20.8514 15.0698M23.5 12.4212C23.5 12.4212 21.6089 12.0427 19.7162 12.4212C17.8235 12.7997 15.9443 13.7046 14.4189 15.4482C12.8936 17.1919 12.3739 19.1127 12.1486 20.7455C11.9234 22.3783 12.1486 24.5293 12.1486 24.5293M12.1486 24.5293L14.7973 21.8806M12.1486 24.5293L9.5 21.8806" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>`

function getCursorCss(
  svg: string,
  r: number,
  tr: number,
  f: boolean,
  color: string,
  hotspotX = 16,
  hotspotY = 16,
) {
  const a = (-tr - r) * (Math.PI / 180);
  const s = Math.sin(a);
  const c = Math.cos(a);
  const dx = 1 * c - 1 * s;
  const dy = 1 * s + 1 * c;

  return (
    `url("data:image/svg+xml,<svg height='32' width='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg' style='color: ${color};'><defs><filter id='shadow' y='-40%' x='-40%' width='180px' height='180%' color-interpolation-filters='sRGB'><feDropShadow dx='${dx}' dy='${dy}' stdDeviation='1.2' flood-opacity='.5'/></filter></defs><g fill='none' transform='${
      f ? ` scale(-1 1) translate(-32 0)` : ''
    } rotate(${r + tr} 16 16)' filter='url(%23shadow)'>` +
    svg.replaceAll(`"`, `'`) +
    `</g></svg>") ${hotspotX} ${hotspotY}, pointer`
  );
}

type CursorFunction = (
  rotation: number,
  flip: boolean,
  color: string,
) => string;
const CURSORS: Record<string, CursorFunction> = {
  default: () => 'default',
  'ew-resize': (r, f, c) => getCursorCss(EDGE_SVG, r, 0, f, c),
  'ns-resize': (r, f, c) => getCursorCss(EDGE_SVG, r, 90, f, c),
  'nesw-resize': (r, f, c) => getCursorCss(CORNER_SVG, r, 0, f, c),
  'nwse-resize': (r, f, c) => getCursorCss(CORNER_SVG, r, 90, f, c),
  'nwse-rotate': (r, f, c) => getCursorCss(ROTATE_CORNER_SVG, r, 0, f, c),
  'nesw-rotate': (r, f, c) => getCursorCss(ROTATE_CORNER_SVG, r, 90, f, c),
  'senw-rotate': (r, f, c) => getCursorCss(ROTATE_CORNER_SVG, r, 180, f, c),
  'swne-rotate': (r, f, c) => getCursorCss(ROTATE_CORNER_SVG, r, 270, f, c),
};

export function getCursor(
  cursor: string,
  rotation = 0,
  color = 'black',
  flip = false,
) {
  return CURSORS[cursor]?.(RAD_TO_DEG * rotation, flip, color);
}
