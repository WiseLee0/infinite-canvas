import {
  App,
  DefaultPlugins,
  Pen,
  CheckboardStyle,
  type RectSerializedNode,
} from '../../ecs/src';
import { Event, UIPlugin } from '../../webcomponents/src';
import '../../webcomponents/src/spectrum';
import { setupZoomToolbar } from '../src/zoom-toolbar';

const COLS = 3;
const ROWS = 3;
const IMAGE_SIZE = 512;
const GAP = 20;

const canvas = document.querySelector<HTMLElement>('#canvas')!;
canvas.addEventListener(Event.READY, (e) => {
  const api = (e as CustomEvent).detail;

  api.setAppState({
    penbarAll: [Pen.HAND, Pen.SELECT, Pen.DRAW_RECT, Pen.IMAGE],
    penbarSelected: Pen.SELECT,
    taskbarVisible: false,
    contextBarVisible: false,
    checkboardStyle: CheckboardStyle.GRID,
  });

  setupZoomToolbar(api, canvas);

  // Create 100 images in a 10x10 grid
  const nodes: RectSerializedNode[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      nodes.push({
        id: `img-${row}-${col}`,
        type: 'rect',
        x: col * (IMAGE_SIZE + GAP),
        y: row * (IMAGE_SIZE + GAP),
        width: IMAGE_SIZE,
        height: IMAGE_SIZE,
        fill: '/testimage.png',
      });
    }
  }
  api.updateNodes(nodes);

  // 等待 ECS 计算完节点 bounds 后，自适应缩放到合适大小
  requestAnimationFrame(() => {
    api.fitToScreen();
  });
});

try {
  const app = new App().addPlugins(...DefaultPlugins, UIPlugin);
  app.run();
} catch (e) {
  console.log(e);
}
