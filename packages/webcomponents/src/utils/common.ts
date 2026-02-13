import { AppState, SerializedNode } from '@infinite-canvas-tutorial/ecs';
import { ExtendedAPI } from '../API';

export function updateAndSelectNodes(
  api: ExtendedAPI,
  appState: AppState,
  nodes: SerializedNode[],
) {
  api.runAtNextTick(() => {
    api.updateNodes(nodes);
    api.record();

    setTimeout(() => {
      api.unhighlightNodes(appState.layersHighlighted);
      api.selectNodes([nodes[0]]);
    }, 100);
  });
}
