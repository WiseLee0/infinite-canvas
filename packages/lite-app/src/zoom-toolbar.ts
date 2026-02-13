const ZOOM_STEPS = [
  0.02, 0.05, 0.1, 0.15, 0.2, 0.33, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4,
];

function findZoomCeil(zoom: number): number {
  return (
    ZOOM_STEPS.find((step) => step > zoom) || ZOOM_STEPS[ZOOM_STEPS.length - 1]
  );
}

function findZoomFloor(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom) || ZOOM_STEPS[0];
}

/**
 * Wire up a vanilla zoom toolbar to an API instance.
 * Expects the DOM to contain elements with IDs: zoom-in, zoom-out, zoom-level, zoom-fit.
 */
export function setupZoomToolbar(api: any, canvasElement: HTMLElement): void {
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const zoomLevelSpan = document.getElementById('zoom-level');
  const zoomFitBtn = document.getElementById('zoom-fit');

  function updateZoomDisplay() {
    if (!zoomLevelSpan) return;
    const zoom = api.getAppState().cameraZoom ?? 1;
    zoomLevelSpan.textContent = `${Math.round(zoom * 100)}%`;
  }

  zoomInBtn?.addEventListener('click', () => {
    const currentZoom = api.getAppState().cameraZoom ?? 1;
    api.zoomTo(findZoomCeil(currentZoom));
  });

  zoomOutBtn?.addEventListener('click', () => {
    const currentZoom = api.getAppState().cameraZoom ?? 1;
    api.zoomTo(findZoomFloor(currentZoom));
  });

  zoomFitBtn?.addEventListener('click', () => {
    api.fitToScreen();
  });

  canvasElement.addEventListener('ic-zoom-changed', () => {
    updateZoomDisplay();
  });

  updateZoomDisplay();
}
