import type { AppState } from '@infinite-canvas-tutorial/ecs';
import { Pen } from '@infinite-canvas-tutorial/ecs';

export interface CanvasOptions {
  penbarAll?: Pen[];
  penbarSelected?: Pen;
  topbarVisible?: boolean;
  taskbarVisible?: boolean;
  contextBarVisible?: boolean;
}

const defaultOptions: CanvasOptions = {
  penbarAll: [Pen.HAND, Pen.SELECT, Pen.DRAW_RECT, Pen.IMAGE],
  penbarSelected: Pen.SELECT,
  taskbarVisible: false,
  contextBarVisible: false,
};

/**
 * Sets up a canvas element by listening for the `ic-ready` event and configuring its AppState.
 * Returns a Promise that resolves with the API instance once the canvas is ready.
 */
export function setupCanvas(
  element: HTMLElement,
  options: CanvasOptions = {},
): Promise<any> {
  const merged = { ...defaultOptions, ...options };

  return new Promise((resolve) => {
    element.addEventListener('ic-ready', (e) => {
      const api = (e as CustomEvent).detail;

      const appState: Partial<AppState> = {};
      if (merged.penbarAll !== undefined) appState.penbarAll = merged.penbarAll;
      if (merged.penbarSelected !== undefined)
        appState.penbarSelected = merged.penbarSelected;
      if (merged.topbarVisible !== undefined)
        appState.topbarVisible = merged.topbarVisible;
      if (merged.taskbarVisible !== undefined)
        appState.taskbarVisible = merged.taskbarVisible;
      if (merged.contextBarVisible !== undefined)
        appState.contextBarVisible = merged.contextBarVisible;

      api.setAppState(appState);
      resolve(api);
    });
  });
}
