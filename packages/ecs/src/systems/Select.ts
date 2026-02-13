import { Entity, System } from '@lastolivegames/becsy';
import { mat3, vec2 } from 'gl-matrix';
import {
  Camera,
  Canvas,
  Children,
  Circle,
  ComputedBounds,
  ComputedCamera,
  Cursor,
  Ellipse,
  FillSolid,
  FractionalIndex,
  GlobalTransform,
  Highlighted,
  Input,
  InputPoint,
  OBB,
  Opacity,
  Parent,
  Path,
  Pen,
  Polyline,
  RBush,
  Rect,
  Renderable,
  Selected,
  Stroke,
  StrokeAttenuation,
  Text,
  Transform,
  Transformable,
  TransformableStatus,
  UI,
  Visibility,
  ZIndex,
  AnchorName,
  VectorNetwork,
  ComputedCameraControl,
  ComputedPoints,
  DropShadow,
  Culled,
  ToBeDeleted,
  Brush,
  HTML,
  Embed,
  Editable,
  Locked,
  Line,
  Mat3,
} from '../components';
import { Commands } from '../commands/Commands';
import {
  calculateOffset,
  createSVGElement,
  decompose,
  distanceBetweenPoints,
  GapSnapLine,
  getCursor,
  getGridPoint,
  isBrowser,
  snapDraggedElements,
  snapToGrid,
} from '../utils';
import { API } from '../API';
import {
  getOBB,
  hitTest,
  setTransformerVisibility,
  syncMaskTransform,
  TRANSFORMER_ANCHOR_STROKE_COLOR,
  TRANSFORMER_MASK_FILL_COLOR,
} from './RenderTransformer';
import { updateGlobalTransform } from './Transform';
import { safeAddComponent } from '../history';
import { updateComputedPoints } from './ComputePoints';

/** Minimum pointer distance (in viewport pixels) to distinguish a drag from a click. */
const DRAG_THRESHOLD = 3;

export enum SelectionMode {
  IDLE = 'IDLE',
  READY_TO_BRUSH = 'READY_TO_BRUSH',
  BRUSH = 'BRUSH',
  READY_TO_SELECT = 'READY_TO_SELECT',
  SELECT = 'SELECT',
  READY_TO_MOVE = 'READY_TO_MOVE',
  MOVE = 'MOVE',
  READY_TO_RESIZE = 'READY_TO_RESIZE',
  RESIZE = 'RESIZE',
  READY_TO_ROTATE = 'READY_TO_ROTATE',
  ROTATE = 'ROTATE',
  READY_TO_MOVE_CONTROL_POINT = 'READY_TO_MOVE_CONTROL_POINT',
  MOVE_CONTROL_POINT = 'MOVE_CONTROL_POINT',
  EDITING = 'EDITING',
}

export interface SelectOBB {
  mode: SelectionMode;
  resizingAnchorName: AnchorName;
  nodes: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  }[];

  obb: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
  sin: number;
  cos: number;

  pointerMoveViewportX: number;
  pointerMoveViewportY: number;

  pointerDownViewportX: number;
  pointerDownViewportY: number;
  pointerDownShiftKey: boolean;
  pointerDownSelectionHandled: boolean;

  // Saved mask transform matrices from saveSelectedOBB time.
  // Used during resize to avoid feedback loop caused by mask drifting.
  savedMaskMatrix: mat3;
  savedMaskMatrixInv: mat3;

  brushContainer: SVGSVGElement;
  snapContainer: SVGSVGElement;

  editing: Entity;

  /** Cached hover target from the previous pointer-move to skip redundant highlight rebuilds. */
  prevHoverEntity: Entity | undefined;
}

/**
 * * Click to select individual object. Hold `Shift` and click on another object to select multiple objects.
 * * Brush(marquee) to select multiple objects.
 * @see https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects
 */
export class Select extends System {
  private readonly commands = new Commands(this);

  private readonly cameras = this.query((q) => q.current.with(Camera).read);

  private selections = new Map<number, SelectOBB>();

  constructor() {
    super();
    this.query(
      (q) =>
        q
          .using(Canvas, ComputedCameraControl, Culled, Brush, Input, Locked)
          .read.update.and.using(
            GlobalTransform,
            InputPoint,
            Cursor,
            Camera,
            UI,
            Selected,
            Highlighted,
            Transform,
            Parent,
            Children,
            Renderable,
            FillSolid,
            Opacity,
            Stroke,
            HTML,
            Embed,
            Rect,
            Circle,
            Ellipse,
            Text,
            Path,
            Polyline,
            Line,
            Brush,
            Visibility,
            ZIndex,
            StrokeAttenuation,
            Transformable,
            VectorNetwork,
            ComputedBounds,
            ComputedPoints,
            DropShadow,
            ToBeDeleted,
            Editable,
          ).write,
    );
    this.query((q) => q.using(ComputedCamera, FractionalIndex, RBush).read);
  }

  private getTopmostEntity(
    api: API,
    x: number,
    y: number,
    selector: (e: Entity) => boolean,
  ) {
    const { x: wx, y: wy } = api.viewport2Canvas({
      x,
      y,
    });
    const entities = api.elementsFromBBox(wx, wy, wx, wy);

    return entities.find(selector);
  }

  private handleSelectedMoving(
    api: API,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
  ) {
    const { snapToPixelGridSize, snapToPixelGridEnabled } = api.getAppState();
    const camera = api.getCamera();

    const isFirstMoveFrame =
      camera.read(Transformable).status !== TransformableStatus.MOVING;
    camera.write(Transformable).status = TransformableStatus.MOVING;

    const selection = this.selections.get(camera.__id);

    let offset: [number, number] = [0, 0];
    if (snapToPixelGridEnabled) {
      const [gridSx, gridSy] = getGridPoint(sx, sy, snapToPixelGridSize);
      const [gridEx, gridEy] = getGridPoint(ex, ey, snapToPixelGridSize);

      const dragOffset: [number, number] = [gridEx - gridSx, gridEy - gridSy];

      const { snapOffset, snapLines } = snapDraggedElements(api, dragOffset);

      const obb = getOBB(camera);
      offset = calculateOffset(
        [obb.x, obb.y],
        dragOffset,
        snapOffset,
        snapToPixelGridSize,
      );

      if (isBrowser) {
        this.renderSnapLines(selection, snapLines, api);
      }
    } else {
      offset = [ex - sx, ey - sy];
    }

    const { selecteds } = camera.read(Transformable);

    // Hide transformer and highlighters only once on the first move frame.
    if (isFirstMoveFrame) {
      setTransformerVisibility(camera, false);
      selecteds.forEach((selected) => {
        if (selected.has(Highlighted)) {
          selected.remove(Highlighted);
        }
      });
    }

    selecteds.forEach((selected) => {
      const node = api.getNodeByEntity(selected);
      const { x, y } = selected.read(Transform).translation;
      api.updateNodeOBB(node, {
        x: x + offset[0],
        y: y + offset[1],
      });
      updateGlobalTransform(selected);
      updateComputedPoints(selected);
    });
  }

  private handleSelectedMoved(api: API, selection: SelectOBB) {
    const camera = api.getCamera();

    api.setNodes(api.getNodes());
    api.record();

    const { selecteds } = camera.read(Transformable);

    // Restore mask and anchor visibility after move.
    setTransformerVisibility(camera, true);

    selecteds.forEach((selected) => {
      if (!selected.has(Highlighted)) {
        selected.add(Highlighted, { strokeWidth: 1 });
      }
    });

    // 移动完成后立即同步更新 mask 的位置，避免等到 RenderTransformer
    // 使用过时的 ComputedBounds 来更新（滞后一帧）。
    syncMaskTransform(camera, getOBB(camera));

    camera.write(Transformable).status = TransformableStatus.MOVED;

    this.saveSelectedOBB(api, selection);
  }

  private handleSelectedResizing(
    api: API,
    canvasX: number,
    canvasY: number,
    selection: SelectOBB,
  ) {
    const camera = api.getCamera();
    camera.write(Transformable).status = TransformableStatus.RESIZING;

    const { mask } = camera.read(Transformable);
    const { resizingAnchorName, cos, sin } = selection;

    // 使用保存的 mask 矩阵将光标转换到 mask 本地坐标。
    // 避免 mask 每帧漂移导致的反馈循环。
    const cursorInLocal = selection.savedMaskMatrixInv
      ? vec2.transformMat3(
          vec2.create(),
          [canvasX, canvasY],
          selection.savedMaskMatrixInv,
        )
      : (() => {
          const p = api.canvas2Transformer({ x: canvasX, y: canvasY }, mask);
          return [p.x, p.y] as [number, number];
        })();
    const x = cursorInLocal[0];
    const y = cursorInLocal[1];

    this.updateAnchorPositions(camera, resizingAnchorName, x, y, cos, sin);
    this.computeOBBFromSavedMask(
      api,
      resizingAnchorName,
      x,
      y,
      cos,
      sin,
      selection,
    );
  }

  /**
   * Update anchor positions based on cursor position and enforce aspect ratio.
   */
  private updateAnchorPositions(
    camera: Entity,
    anchorName: AnchorName,
    x: number,
    y: number,
    cos: number,
    sin: number,
  ) {
    const { tlAnchor, trAnchor, blAnchor, brAnchor } =
      camera.read(Transformable);
    const prevTlAnchorX = tlAnchor.read(Circle).cx;
    const prevTlAnchorY = tlAnchor.read(Circle).cy;
    const prevBrAnchorX = brAnchor.read(Circle).cx;
    const prevBrAnchorY = brAnchor.read(Circle).cy;

    let anchor: Entity;
    if (anchorName === AnchorName.TOP_LEFT) {
      anchor = tlAnchor;
    } else if (anchorName === AnchorName.TOP_RIGHT) {
      anchor = trAnchor;
    } else if (anchorName === AnchorName.BOTTOM_LEFT) {
      anchor = blAnchor;
    } else if (anchorName === AnchorName.BOTTOM_RIGHT) {
      anchor = brAnchor;
    }

    if (anchor) {
      Object.assign(anchor.write(Circle), {
        cx: x,
        cy: y,
      });
    }

    let newHypotenuse: number;

    if (anchorName === AnchorName.TOP_LEFT) {
      const comparePoint = {
        x: brAnchor.read(Circle).cx,
        y: brAnchor.read(Circle).cy,
      };
      newHypotenuse = Math.sqrt(
        Math.pow(comparePoint.x - x, 2) + Math.pow(comparePoint.y - y, 2),
      );

      const { cx, cy } = tlAnchor.read(Circle);
      const reverseX = cx > comparePoint.x ? -1 : 1;
      const reverseY = cy > comparePoint.y ? -1 : 1;

      Object.assign(tlAnchor.write(Circle), {
        cx: comparePoint.x - newHypotenuse * cos * reverseX,
        cy: comparePoint.y - newHypotenuse * sin * reverseY,
      });
    } else if (anchorName === AnchorName.TOP_RIGHT) {
      const comparePoint = {
        x: blAnchor.read(Circle).cx,
        y: blAnchor.read(Circle).cy,
      };

      newHypotenuse = Math.sqrt(
        Math.pow(x - comparePoint.x, 2) + Math.pow(comparePoint.y - y, 2),
      );

      const { cx, cy } = trAnchor.read(Circle);
      const reverseX = cx < comparePoint.x ? -1 : 1;
      const reverseY = cy > comparePoint.y ? -1 : 1;

      Object.assign(trAnchor.write(Circle), {
        cx: comparePoint.x + newHypotenuse * cos * reverseX,
        cy: comparePoint.y - newHypotenuse * sin * reverseY,
      });

      tlAnchor.write(Circle).cy = trAnchor.read(Circle).cy;
      brAnchor.write(Circle).cx = trAnchor.read(Circle).cx;
    } else if (anchorName === AnchorName.BOTTOM_LEFT) {
      const comparePoint = {
        x: trAnchor.read(Circle).cx,
        y: trAnchor.read(Circle).cy,
      };

      newHypotenuse = Math.sqrt(
        Math.pow(comparePoint.x - x, 2) + Math.pow(y - comparePoint.y, 2),
      );

      const reverseX = comparePoint.x < x ? -1 : 1;
      const reverseY = y < comparePoint.y ? -1 : 1;

      Object.assign(blAnchor.write(Circle), {
        cx: comparePoint.x - newHypotenuse * cos * reverseX,
        cy: comparePoint.y + newHypotenuse * sin * reverseY,
      });

      tlAnchor.write(Circle).cx = blAnchor.read(Circle).cx;
      brAnchor.write(Circle).cy = blAnchor.read(Circle).cy;
    } else if (anchorName === AnchorName.BOTTOM_RIGHT) {
      const comparePoint = {
        x: tlAnchor.read(Circle).cx,
        y: tlAnchor.read(Circle).cy,
      };

      newHypotenuse = Math.sqrt(
        Math.pow(x - comparePoint.x, 2) + Math.pow(y - comparePoint.y, 2),
      );

      const reverseX = brAnchor.read(Circle).cx < comparePoint.x ? -1 : 1;
      const reverseY = brAnchor.read(Circle).cy < comparePoint.y ? -1 : 1;
      Object.assign(brAnchor.write(Circle), {
        cx: comparePoint.x + newHypotenuse * cos * reverseX,
        cy: comparePoint.y + newHypotenuse * sin * reverseY,
      });
    } else if (anchorName === AnchorName.TOP_CENTER) {
      tlAnchor.write(Circle).cy = y;
    } else if (anchorName === AnchorName.BOTTOM_CENTER) {
      brAnchor.write(Circle).cy = y;
    } else if (anchorName === AnchorName.MIDDLE_LEFT) {
      tlAnchor.write(Circle).cx = x;
    } else if (anchorName === AnchorName.MIDDLE_RIGHT) {
      brAnchor.write(Circle).cx = x;
    }

    // Aspect ratio enforcement for edge anchors.
    // Guard against degenerate cos/sin to avoid division by zero.
    if (
      anchorName === AnchorName.MIDDLE_LEFT ||
      anchorName === AnchorName.MIDDLE_RIGHT
    ) {
      if (cos < 1e-10) return;
      const newWidth = brAnchor.read(Circle).cx - tlAnchor.read(Circle).cx;
      const tan = sin / cos;
      const newHeight = Math.abs(newWidth) * tan;
      const deltaY = newHeight - (prevBrAnchorY - prevTlAnchorY);
      brAnchor.write(Circle).cy = brAnchor.read(Circle).cy + deltaY / 2;
      tlAnchor.write(Circle).cy = tlAnchor.read(Circle).cy - deltaY / 2;
    } else if (
      anchorName === AnchorName.TOP_CENTER ||
      anchorName === AnchorName.BOTTOM_CENTER
    ) {
      if (cos < 1e-10 || sin < 1e-10) return;
      const newHeight = brAnchor.read(Circle).cy - tlAnchor.read(Circle).cy;
      const tan = sin / cos;
      const newWidth = Math.abs(newHeight) / tan;
      const deltaX = newWidth - (prevBrAnchorX - prevTlAnchorX);
      brAnchor.write(Circle).cx = brAnchor.read(Circle).cx + deltaX / 2;
      tlAnchor.write(Circle).cx = tlAnchor.read(Circle).cx - deltaX / 2;
    }
  }

  /**
   * Compute new OBB from saved mask matrix and apply to selected nodes.
   */
  private computeOBBFromSavedMask(
    api: API,
    anchorName: AnchorName,
    x: number,
    y: number,
    cos: number,
    sin: number,
    selection: SelectOBB,
  ) {
    if (!selection.savedMaskMatrix) return;

    const savedW = selection.obb.width;
    const savedH = selection.obb.height;
    const { rotation, scaleX, scaleY } = selection.obb;

    // Guard against degenerate OBB to avoid division by zero.
    if (savedW < 1e-10 || savedH < 1e-10) return;

    let width: number;
    let height: number;
    let minX: number;
    let minY: number;

    if (
      anchorName === AnchorName.MIDDLE_LEFT ||
      anchorName === AnchorName.MIDDLE_RIGHT
    ) {
      const fixedX = anchorName === AnchorName.MIDDLE_RIGHT ? 0 : savedW;
      width = Math.abs(x - fixedX);
      height = width * (savedH / savedW);
      minX = Math.min(x, fixedX);
      const centerY = savedH / 2;
      minY = centerY - height / 2;
    } else if (
      anchorName === AnchorName.TOP_CENTER ||
      anchorName === AnchorName.BOTTOM_CENTER
    ) {
      const fixedY = anchorName === AnchorName.BOTTOM_CENTER ? 0 : savedH;
      height = Math.abs(y - fixedY);
      width = height * (savedW / savedH);
      minY = Math.min(y, fixedY);
      const centerX = savedW / 2;
      minX = centerX - width / 2;
    } else {
      // 角锚点：对角固定，等比缩放
      let fixedLocalX: number;
      let fixedLocalY: number;
      if (anchorName === AnchorName.BOTTOM_RIGHT) {
        fixedLocalX = 0;
        fixedLocalY = 0;
      } else if (anchorName === AnchorName.TOP_LEFT) {
        fixedLocalX = savedW;
        fixedLocalY = savedH;
      } else if (anchorName === AnchorName.TOP_RIGHT) {
        fixedLocalX = 0;
        fixedLocalY = savedH;
      } else {
        // BOTTOM_LEFT
        fixedLocalX = savedW;
        fixedLocalY = 0;
      }

      const dx = x - fixedLocalX;
      const dy = y - fixedLocalY;
      const hyp = Math.sqrt(dx * dx + dy * dy);
      width = hyp * cos;
      height = hyp * sin;

      const rx = dx >= 0 ? 1 : -1;
      const ry = dy >= 0 ? 1 : -1;
      const cornerX = fixedLocalX + width * rx;
      const cornerY = fixedLocalY + height * ry;
      minX = Math.min(fixedLocalX, cornerX);
      minY = Math.min(fixedLocalY, cornerY);
    }

    if (width < 0.01 && height < 0.01) {
      return;
    }

    // 将保存的 mask 本地坐标转换为画布坐标
    const originInCanvas = vec2.transformMat3(
      vec2.create(),
      [minX, minY],
      selection.savedMaskMatrix,
    );
    const ox = originInCanvas[0];
    const oy = originInCanvas[1];

    this.fitSelected(
      api,
      {
        x: ox,
        y: oy,
        width,
        height,
        rotation,
        scaleX,
        scaleY,
      },
      selection,
    );

    // 立即同步更新 mask 的 Transform、Rect 和锚点，避免等到
    // RenderTransformer 使用过时的 ComputedBounds 来更新（滞后一帧）。
    const camera = api.getCamera();
    syncMaskTransform(camera, {
      x: ox,
      y: oy,
      width,
      height,
      rotation,
      scaleX,
      scaleY,
    });
  }

  private handleSelectedResized(api: API, selection: SelectOBB) {
    const camera = api.getCamera();
    camera.write(Transformable).status = TransformableStatus.RESIZED;

    api.setNodes(api.getNodes());
    api.record();

    const { selecteds } = camera.read(Transformable);
    selecteds.forEach((selected) => {
      if (!selected.has(Highlighted)) {
        selected.add(Highlighted, { strokeWidth: 1 });
      }
    });

    this.saveSelectedOBB(api, selection);
  }

  private handleSelectedRotated(api: API, selection: SelectOBB) {
    const camera = api.getCamera();
    camera.write(Transformable).status = TransformableStatus.ROTATED;

    api.setNodes(api.getNodes());
    api.record();

    const { selecteds } = camera.read(Transformable);
    selecteds.forEach((selected) => {
      if (!selected.has(Highlighted)) {
        selected.add(Highlighted, { strokeWidth: 1 });
      }
    });

    this.saveSelectedOBB(api, selection);
  }

  private handleBrushing(api: API, viewportX: number, viewportY: number) {
    const camera = api.getCamera();
    const selection = this.selections.get(camera.__id);

    const { pointerDownViewportX, pointerDownViewportY } = camera.read(
      ComputedCameraControl,
    );

    // Use a threshold to avoid showing the selection brush when the pointer is moved a little.
    const shouldShowSelectionBrush =
      distanceBetweenPoints(
        viewportX,
        viewportY,
        pointerDownViewportX,
        pointerDownViewportY,
      ) > 10;

    if (shouldShowSelectionBrush) {
      this.renderBrush(
        selection,
        // <rect> attribute height: A negative value is not valid. So we need to use the absolute value.
        Math.min(pointerDownViewportX, viewportX),
        Math.min(pointerDownViewportY, viewportY),
        Math.abs(viewportX - pointerDownViewportX),
        Math.abs(viewportY - pointerDownViewportY),
      );

      // Select elements in the brush
      this.applyBrushSelection(api, selection, true);
    }
  }

  execute() {
    this.cameras.current.forEach((camera) => {
      if (!camera.has(Camera)) {
        return;
      }

      const { canvas } = camera.read(Camera);
      if (!canvas) {
        return;
      }

      const { inputPoints, api } = canvas.read(Canvas);
      const pen = api.getAppState().penbarSelected;

      const input = canvas.read(Input);

      if (pen !== Pen.SELECT) {
        // Clear selection
        if (pen !== Pen.VECTOR_NETWORK && pen !== Pen.ERASER) {
          api.selectNodes([]);
        }
        api.highlightNodes([]);

        if (pen !== Pen.VECTOR_NETWORK) {
          return;
        }
      }

      const cursor = canvas.write(Cursor);

      safeAddComponent(camera, Transformable);

      if (!this.selections.has(camera.__id)) {
        const selection = {
          mode: SelectionMode.IDLE,
          resizingAnchorName: AnchorName.INSIDE,
          nodes: api.getNodes().map((node) => ({
            ...node,
            ...api.getAbsoluteTransformAndSize(node),
          })),
          obb: {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          },
          sin: 0,
          cos: 0,
          pointerMoveViewportX: 0,
          pointerMoveViewportY: 0,
          pointerDownViewportX: 0,
          pointerDownViewportY: 0,
          pointerDownShiftKey: false,
          pointerDownSelectionHandled: false,
          brushContainer: createSVGElement('svg') as SVGSVGElement,
          snapContainer: createSVGElement('svg') as SVGSVGElement,
          editing: undefined,
          savedMaskMatrix: null,
          savedMaskMatrixInv: null,
          prevHoverEntity: undefined,
        };
        this.selections.set(camera.__id, selection);

        if (isBrowser) {
          selection.brushContainer.style.overflow = 'visible';
          selection.brushContainer.style.position = 'absolute';
          selection.snapContainer.style.overflow = 'visible';
          selection.snapContainer.style.position = 'absolute';

          const $svgLayer = api.getSvgLayer();
          if ($svgLayer) {
            $svgLayer.appendChild(selection.brushContainer);
            $svgLayer.appendChild(selection.snapContainer);
          }
        }
      }

      const selection = this.selections.get(camera.__id);
      if (input.pointerDownTrigger) {
        const [x, y] = input.pointerViewport;
        selection.pointerDownViewportX = x;
        selection.pointerDownViewportY = y;
        selection.pointerDownShiftKey = input.shiftKey;
        selection.pointerDownSelectionHandled = false;

        if (selection.editing) {
          if (selection.mode === SelectionMode.IDLE) {
            api.updateNode(api.getNodeByEntity(selection.editing), {
              isEditing: false,
            });

            selection.editing = undefined;
            selection.mode = SelectionMode.SELECT;
            api.setAppState({
              editingPoints: [],
            });
          } else if (selection.mode === SelectionMode.READY_TO_MOVE) {
            api.setAppState({
              editingPoints: [[x, y]],
            });
          }

          return;
        }

        if (selection.mode === SelectionMode.IDLE) {
          selection.mode = SelectionMode.READY_TO_BRUSH;
          api.selectNodes([]);
        } else if (selection.mode === SelectionMode.READY_TO_SELECT) {
          const { selecteds: existingSelecteds } = camera.read(Transformable);
          if (existingSelecteds.length > 0) {
            // Check if pointer is inside the transformer box.
            const ht = hitTest(api, { x, y });
            if (ht?.anchor === AnchorName.INSIDE) {
              selection.mode = SelectionMode.MOVE;
            } else {
              // Outside transformer — select immediately on pointerDown.
              selection.mode = SelectionMode.SELECT;
            }
          } else {
            selection.mode = SelectionMode.SELECT;
          }
        } else if (selection.mode === SelectionMode.READY_TO_MOVE) {
          selection.mode = SelectionMode.MOVE;
        } else if (
          selection.mode === SelectionMode.READY_TO_RESIZE ||
          selection.mode === SelectionMode.READY_TO_ROTATE
        ) {
          this.saveSelectedOBB(api, selection);
          if (selection.mode === SelectionMode.READY_TO_RESIZE) {
            selection.mode = SelectionMode.RESIZE;
          } else if (selection.mode === SelectionMode.READY_TO_ROTATE) {
            selection.mode = SelectionMode.ROTATE;
          }
        }

        if (selection.mode === SelectionMode.SELECT) {
          const toSelect = this.getTopmostEntity(api, x, y, (e) => !e.has(UI));
          if (toSelect) {
            const selected = api.getNodeByEntity(toSelect);
            if (selected) {
              if (
                input.shiftKey &&
                api.getAppState().layersSelected.includes(selected.id)
              ) {
                // Shift-click toggles: remove if already selected.
                api.deselectNodes([selected]);
              } else {
                api.selectNodes([selected], input.shiftKey); // single or multi select
              }
              selection.pointerDownSelectionHandled = true;
            }
          }

          if (api.getAppState().layersSelected.length > 0) {
            selection.mode = SelectionMode.MOVE;
          }
        }
      }

      let toHighlight: Entity | undefined;
      if (camera.has(ComputedCamera) && inputPoints.length === 0) {
        const [x, y] = input.pointerViewport;
        const shouldRecomputeHover =
          selection.pointerMoveViewportX !== x ||
          selection.pointerMoveViewportY !== y ||
          input.pointerDownTrigger ||
          input.pointerUpTrigger;
        if (shouldRecomputeHover) {
          selection.pointerMoveViewportX = x;
          selection.pointerMoveViewportY = y;

          // Highlight the topmost non-ui element
          toHighlight = this.getTopmostEntity(api, x, y, (e) => !e.has(UI));
          if (toHighlight) {
            if (
              selection.mode !== SelectionMode.BRUSH &&
              selection.mode !== SelectionMode.MOVE &&
              selection.mode !== SelectionMode.RESIZE &&
              selection.mode !== SelectionMode.ROTATE
            ) {
              selection.mode = SelectionMode.READY_TO_SELECT;
            }
          } else if (
            selection.mode !== SelectionMode.BRUSH &&
            selection.mode !== SelectionMode.RESIZE &&
            selection.mode !== SelectionMode.ROTATE &&
            selection.mode !== SelectionMode.MOVE
          ) {
            selection.mode = SelectionMode.IDLE;
          }
          const { mask, selecteds } = camera.read(Transformable);

          cursor.value = 'default';

          // Hit test with transformer
          if (selecteds.length >= 1) {
            const { anchor, cursor: cursorName } = hitTest(api, { x, y }) || {};

            if (
              selection.mode !== SelectionMode.BRUSH &&
              selection.mode !== SelectionMode.MOVE &&
              selection.mode !== SelectionMode.RESIZE &&
              selection.mode !== SelectionMode.ROTATE
            ) {
              if (anchor) {
                const { rotation, scale } = mask.read(Transform);
                cursor.value =
                  getCursor(
                    cursorName,
                    rotation,
                    '',
                    Math.sign(scale[0] * scale[1]) < 0,
                  ) ?? cursorName;
                selection.resizingAnchorName = anchor;

                if (cursorName.includes('rotate')) {
                  selection.mode = SelectionMode.READY_TO_ROTATE;
                  toHighlight = undefined;
                } else if (cursorName.includes('resize')) {
                  selection.mode = SelectionMode.READY_TO_RESIZE;
                  toHighlight = undefined;
                } else if (anchor === AnchorName.INSIDE) {
                  // Allow hover highlight for non-selected elements inside the transformer.
                  if (toHighlight && !selecteds.includes(toHighlight)) {
                    selection.mode = SelectionMode.READY_TO_SELECT;
                  } else {
                    // In group can toggle selection.
                    if (input.shiftKey) {
                      selection.mode = SelectionMode.READY_TO_SELECT;
                    } else {
                      // Disable highlight, only allow move.
                      toHighlight = undefined;

                      selection.mode = SelectionMode.READY_TO_MOVE;
                    }
                  }
                } else if (toHighlight) {
                  selection.mode = SelectionMode.READY_TO_SELECT;
                }
              }
            }
          }

          // Only rebuild highlight list when hover target changes to avoid
          // per-frame allocation and redundant highlightNodes calls.
          if (
            toHighlight !== selection.prevHoverEntity ||
            input.pointerDownTrigger ||
            input.pointerUpTrigger
          ) {
            selection.prevHoverEntity = toHighlight;

            const selectedNodeIds = selecteds
              .map((e) => api.getNodeByEntity(e))
              .filter(Boolean)
              .map((n) => n.id);
            const hoverNode = toHighlight
              ? api.getNodeByEntity(toHighlight)
              : undefined;
            const highlightIds =
              hoverNode && !selectedNodeIds.includes(hoverNode.id)
                ? [...selectedNodeIds, hoverNode.id]
                : selectedNodeIds;
            api.highlightNodes(highlightIds, false, true, 1);
            // Hover gets thicker stroke to distinguish from selection highlight.
            if (
              hoverNode &&
              toHighlight &&
              toHighlight.has(Highlighted) &&
              !selecteds.includes(toHighlight)
            ) {
              toHighlight.write(Highlighted).strokeWidth = 2;
            }
          }
        }
      }

      // Dragging
      inputPoints.forEach((point) => {
        const inputPoint = point.write(InputPoint);
        const {
          prevPoint: [prevX, prevY],
        } = inputPoint;
        const [x, y] = input.pointerViewport;
        if (prevX === x && prevY === y) {
          return;
        }

        let { x: sx, y: sy } = api.viewport2Canvas({
          x: prevX,
          y: prevY,
        });
        let { x: ex, y: ey } = api.viewport2Canvas({
          x,
          y,
        });

        const { snapToPixelGridEnabled, snapToPixelGridSize } =
          api.getAppState();
        if (snapToPixelGridEnabled) {
          sx = snapToGrid(sx, snapToPixelGridSize);
          sy = snapToGrid(sy, snapToPixelGridSize);
          ex = snapToGrid(ex, snapToPixelGridSize);
          ey = snapToGrid(ey, snapToPixelGridSize);
        }

        if (
          selection.mode === SelectionMode.READY_TO_BRUSH ||
          selection.mode === SelectionMode.BRUSH
        ) {
          this.handleBrushing(api, x, y);
          selection.mode = SelectionMode.BRUSH;
        } else if (selection.mode === SelectionMode.MOVE) {
          // Only start actual moving after exceeding drag threshold (3px).
          // This prevents micro-movements during clicks from changing state
          // (status, visibility) that would be left dangling if the pointerUp
          // handler treats the gesture as a click instead of a drag.
          const dist = distanceBetweenPoints(
            x,
            y,
            selection.pointerDownViewportX,
            selection.pointerDownViewportY,
          );
          if (dist >= DRAG_THRESHOLD) {
            this.handleSelectedMoving(api, sx, sy, ex, ey);
          }
        } else if (selection.mode === SelectionMode.RESIZE) {
          this.handleSelectedResizing(api, ex, ey, selection);
        } else if (selection.mode === SelectionMode.ROTATE) {
          // 暂时不支持旋转
        }
      });

      if (input.key === 'Escape') {
        api.selectNodes([]);
        api.highlightNodes([]);
        if (selection.mode === SelectionMode.BRUSH) {
          this.hideBrush(selection);
        }
      }

      if (input.pointerUpTrigger) {
        if (selection.mode === SelectionMode.BRUSH) {
          this.hideBrush(selection);
          this.applyBrushSelection(api, selection, true);
        } else if (selection.mode === SelectionMode.MOVE) {
          const [upX, upY] = input.pointerViewport;
          const dragDist = distanceBetweenPoints(
            upX,
            upY,
            selection.pointerDownViewportX,
            selection.pointerDownViewportY,
          );

          if (dragDist < DRAG_THRESHOLD) {
            // Below threshold → treat as click, select element under cursor.
            const toSelect = this.getTopmostEntity(
              api,
              upX,
              upY,
              (e) => !e.has(UI),
            );
            if (toSelect) {
              const selected = api.getNodeByEntity(toSelect);
              if (selected) {
                if (selection.pointerDownSelectionHandled) {
                  // Selection already handled on pointerDown for this click.
                  selection.pointerDownSelectionHandled = false;
                } else {
                  if (
                    selection.pointerDownShiftKey &&
                    api.getAppState().layersSelected.includes(selected.id)
                  ) {
                    // Shift-click toggles: remove if already selected.
                    api.deselectNodes([selected]);
                  } else {
                    api.selectNodes([selected], selection.pointerDownShiftKey);
                  }
                }
              }
            }
            selection.pointerDownSelectionHandled = false;
          } else {
            // Real drag — commit the move.
            this.handleSelectedMoved(api, selection);
          }
          selection.mode = SelectionMode.READY_TO_MOVE;
        } else if (
          selection.mode === SelectionMode.RESIZE ||
          selection.mode === SelectionMode.READY_TO_RESIZE
        ) {
          this.handleSelectedResized(api, selection);
          selection.mode = SelectionMode.READY_TO_RESIZE;
        } else if (selection.mode === SelectionMode.ROTATE) {
          this.handleSelectedRotated(api, selection);
          selection.mode = SelectionMode.READY_TO_ROTATE;
        }

        if (isBrowser) {
          this.clearSnapLines(selection);
        }
      }
    });
  }

  finalize(): void {
    this.selections.forEach(({ brushContainer, snapContainer }) => {
      brushContainer.remove();
      snapContainer.remove();
    });
    this.selections.clear();
  }

  private applyBrushSelection(
    api: API,
    selection: SelectOBB,
    needHighlight: boolean,
  ) {
    if (selection.brushContainer) {
      const brush = selection.brushContainer.firstChild as SVGRectElement;
      if (!brush) {
        return;
      }
      const x = parseFloat(brush.getAttribute('x') || '0');
      const y = parseFloat(brush.getAttribute('y') || '0');
      const width = parseFloat(brush.getAttribute('width') || '0');
      const height = parseFloat(brush.getAttribute('height') || '0');
      const { x: minX, y: minY } = api.viewport2Canvas({
        x,
        y,
      });
      const { x: maxX, y: maxY } = api.viewport2Canvas({
        x: x + width,
        y: y + height,
      });
      const selecteds = api
        .elementsFromBBox(minX, minY, maxX, maxY)
        // Only select direct children of the camera
        .filter((e) => !e.has(UI) && e.read(Children).parent.has(Camera))
        // TODO: locked layers should not be selected
        .map((e) => api.getNodeByEntity(e));
      api.selectNodes(selecteds);
      if (needHighlight) {
        api.highlightNodes(
          selecteds.map((n) => n.id),
          false,
          true,
          1,
        );
      }
    }
  }

  private saveSelectedOBB(api: API, selection: SelectOBB) {
    const camera = api.getCamera();
    const obb = getOBB(camera);
    selection.obb = {
      x: obb.x,
      y: obb.y,
      width: obb.width,
      height: obb.height,
      rotation: obb.rotation,
      scaleX: obb.scaleX,
      scaleY: obb.scaleY,
    };
    const { width, height } = selection.obb;
    const hypotenuse = Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2));
    if (hypotenuse < 1e-10) {
      selection.sin = 0;
      selection.cos = 1;
    } else {
      selection.sin = Math.abs(height / hypotenuse);
      selection.cos = Math.abs(width / hypotenuse);
    }
    selection.nodes = [
      ...api.getNodes().map((node) => ({
        ...node,
        ...api.getAbsoluteTransformAndSize(node),
      })),
    ];

    // Save the mask's GlobalTransform at this point to use during resize.
    // This prevents a feedback loop: node moves → mask follows → coordinate
    // conversion drifts → node moves more.
    const { mask } = camera.read(Transformable);
    if (mask) {
      selection.savedMaskMatrix = mat3.clone(
        Mat3.toGLMat3(mask.read(GlobalTransform).matrix),
      );
      selection.savedMaskMatrixInv = mat3.invert(
        mat3.create(),
        selection.savedMaskMatrix,
      );
    }
  }

  private fitSelected(api: API, newAttrs: OBB, selection: SelectOBB) {
    const camera = api.getCamera();
    const { selecteds } = camera.read(Transformable);
    const { width, height } = newAttrs;
    const epsilon = 0.01;
    const oldAttrs = {
      x: selection.obb.x,
      y: selection.obb.y,
      width: selection.obb.width,
      height: selection.obb.height,
      rotation: selection.obb.rotation,
      scaleX: selection.obb.scaleX,
      scaleY: selection.obb.scaleY,
    };

    const baseSize = 10000000;
    const oldTr = mat3.create();
    mat3.translate(oldTr, oldTr, [oldAttrs.x, oldAttrs.y]);
    mat3.rotate(oldTr, oldTr, oldAttrs.rotation);
    mat3.scale(oldTr, oldTr, [
      oldAttrs.width / baseSize,
      oldAttrs.height / baseSize,
    ]);
    const newTr = mat3.create();
    const newScaleX = newAttrs.width / baseSize;
    const newScaleY = newAttrs.height / baseSize;

    // Width and height are always positive after normalization.
    mat3.translate(newTr, newTr, [newAttrs.x, newAttrs.y]);
    mat3.rotate(newTr, newTr, newAttrs.rotation);
    mat3.scale(newTr, newTr, [newScaleX, newScaleY]);

    // Borrow from Konva.js
    // @see https://github.com/konvajs/konva/blob/9a9bd00cd377a6d12cce3ee7c9fbf906afa55de5/src/shapes/Transformer.ts#L1103
    // [delta transform] = [new transform] * [old transform inverted]
    const delta = mat3.multiply(
      newTr,
      newTr,
      mat3.invert(mat3.create(), oldTr),
    );

    selecteds.forEach((selected) => {
      const node = api.getNodeByEntity(selected);
      const oldNode = selection.nodes.find((n) => n.id === node.id);
      // for each node we have the same [delta transform]
      // the equations is
      // [delta transform] * [parent transform] * [old local transform] = [parent transform] * [new local transform]
      // and we need to find [new local transform]
      // [new local] = [parent inverted] * [delta] * [parent] * [old local]
      const parentTransform = api.getParentTransform(selected);
      const localTransform = api.getTransform(oldNode);

      const newLocalTransform = mat3.create();
      mat3.multiply(newLocalTransform, parentTransform, localTransform);
      mat3.multiply(newLocalTransform, delta, newLocalTransform);
      mat3.multiply(
        newLocalTransform,
        mat3.invert(mat3.create(), parentTransform),
        newLocalTransform,
      );

      const { rotation, translation, scale } = decompose(newLocalTransform);

      const obb = {
        x: translation[0],
        y: translation[1],
        width: Math.max(oldNode.width * scale[0], epsilon),
        height: Math.max(oldNode.height * scale[1], epsilon),
        rotation,
        scaleX: oldAttrs.scaleX * (Math.sign(width) || 1),
        scaleY: oldAttrs.scaleY * (Math.sign(height) || 1),
      };

      api.updateNodeOBB(
        node,
        obb,
        node.lockAspectRatio,
        newLocalTransform,
        oldNode,
      );
      selection.obb.scaleX = obb.scaleX;
      selection.obb.scaleY = obb.scaleY;

      updateGlobalTransform(selected);
      updateComputedPoints(selected);
    });
  }

  private hideBrush(selection: SelectOBB) {
    if (selection.brushContainer) {
      selection.brushContainer.setAttribute('visibility', 'hidden');
    }
    selection.mode = SelectionMode.IDLE;
  }

  private renderBrush(
    selection: SelectOBB,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    const { brushContainer } = selection;
    brushContainer.setAttribute('visibility', 'visible');

    let brush = brushContainer.firstChild as SVGRectElement;
    if (!brush) {
      brush = createSVGElement('rect') as SVGRectElement;
      brush.setAttribute('x', '0');
      brush.setAttribute('y', '0');
      brush.setAttribute('width', '0');
      brush.setAttribute('height', '0');
      brush.setAttribute('opacity', '0.5');
      brush.setAttribute('fill', TRANSFORMER_MASK_FILL_COLOR);
      brush.setAttribute('stroke', TRANSFORMER_ANCHOR_STROKE_COLOR);
      brush.setAttribute('stroke-width', '1');
      brushContainer.appendChild(brush);
    }

    brush.setAttribute('x', x.toString());
    brush.setAttribute('y', y.toString());
    brush.setAttribute('width', width.toString());
    brush.setAttribute('height', height.toString());
  }

  private clearSnapLines(selection: SelectOBB) {
    const { snapContainer } = selection;
    snapContainer.innerHTML = '';
  }

  private renderSnapLines(
    selection: SelectOBB,
    snapLines: { type: string; points: [number, number][] }[],
    api: API,
  ) {
    const { snapLineStroke, snapLineStrokeWith } = api.getAppState();
    const { snapContainer } = selection;
    this.clearSnapLines(selection);

    snapLines.forEach((snapLine) => {
      const { type, points } = snapLine;
      if (type === 'points') {
        const pointsInViewport = points.map((p) =>
          api.canvas2Viewport({ x: p[0], y: p[1] }),
        );

        const line = createSVGElement('polyline') as SVGPolylineElement;
        line.setAttribute(
          'points',
          pointsInViewport.map((p) => `${p.x},${p.y}`).join(' '),
        );
        line.setAttribute('stroke', snapLineStroke);
        line.setAttribute('stroke-width', `${snapLineStrokeWith}`);
        snapContainer.appendChild(line);

        pointsInViewport.forEach((p) => {
          // cross point
          const tlbr = createSVGElement('line') as SVGLineElement;
          tlbr.setAttribute('x1', `${p.x - 4}`);
          tlbr.setAttribute('y1', `${p.y - 4}`);
          tlbr.setAttribute('x2', `${p.x + 4}`);
          tlbr.setAttribute('y2', `${p.y + 4}`);
          tlbr.setAttribute('stroke', snapLineStroke);
          tlbr.setAttribute('stroke-width', `${snapLineStrokeWith}`);
          snapContainer.appendChild(tlbr);

          const trbl = createSVGElement('line') as SVGLineElement;
          trbl.setAttribute('x1', `${p.x - 4}`);
          trbl.setAttribute('y1', `${p.y + 4}`);
          trbl.setAttribute('x2', `${p.x + 4}`);
          trbl.setAttribute('y2', `${p.y - 4}`);
          trbl.setAttribute('stroke', snapLineStroke);
          trbl.setAttribute('stroke-width', `${snapLineStrokeWith}`);
          snapContainer.appendChild(trbl);
        });
      } else if (type === 'gap') {
        // @see https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/renderer/renderSnaps.ts#L123
        const { x: fromX, y: fromY } = api.canvas2Viewport({
          x: points[0][0],
          y: points[0][1],
        });
        const { x: toX, y: toY } = api.canvas2Viewport({
          x: points[1][0],
          y: points[1][1],
        });
        const distance = Math.sqrt(
          Math.pow(points[0][0] - points[1][0], 2) +
            Math.pow(points[0][1] - points[1][1], 2),
        );
        const from = [fromX, fromY] as [number, number];
        const to = [toX, toY] as [number, number];
        const { direction } = snapLine as GapSnapLine;

        // a horizontal gap snap line
        // |–––––––||–––––––|
        // ^    ^   ^       ^
        // \    \   \       \
        // (1)  (2) (3)     (4)

        const FULL = 8;
        const HALF = FULL / 2;
        const QUARTER = FULL / 4;
        // (1)
        if (direction === 'horizontal') {
          const halfPoint = [(from[0] + to[0]) / 2, from[1]];

          this.renderSnapLine(
            [from[0], from[1] - FULL],
            [from[0], from[1] + FULL],
            api,
            snapContainer,
          );

          // (3)
          this.renderSnapLine(
            [halfPoint[0] - QUARTER, halfPoint[1] - HALF],
            [halfPoint[0] - QUARTER, halfPoint[1] + HALF],
            api,
            snapContainer,
          );
          this.renderSnapLine(
            [halfPoint[0] + QUARTER, halfPoint[1] - HALF],
            [halfPoint[0] + QUARTER, halfPoint[1] + HALF],
            api,
            snapContainer,
          );

          // (4)
          this.renderSnapLine(
            [to[0], to[1] - FULL],
            [to[0], to[1] + FULL],
            api,
            snapContainer,
          );

          // (2)
          this.renderSnapLine(from, to, api, snapContainer);

          // Render distance label below (3)

          const label = createSVGElement('text') as SVGTextElement;
          label.setAttribute('x', `${halfPoint[0]}`);
          label.setAttribute('y', `${halfPoint[1] + 16}`);
          label.setAttribute('text-anchor', 'middle');
          label.setAttribute('dominant-baseline', 'middle');
          label.textContent = `${distance.toFixed(0)}`;
          label.setAttribute('fill', snapLineStroke);
          label.setAttribute('font-size', '12');
          snapContainer.appendChild(label);
        } else {
          const halfPoint = [from[0], (from[1] + to[1]) / 2];

          this.renderSnapLine(
            [from[0] - FULL, from[1]],
            [from[0] + FULL, from[1]],
            api,
            snapContainer,
          );

          // (3)
          this.renderSnapLine(
            [halfPoint[0] - HALF, halfPoint[1] - QUARTER],
            [halfPoint[0] + HALF, halfPoint[1] - QUARTER],
            api,
            snapContainer,
          );
          this.renderSnapLine(
            [halfPoint[0] - HALF, halfPoint[1] + QUARTER],
            [halfPoint[0] + HALF, halfPoint[1] + QUARTER],
            api,
            snapContainer,
          );

          // (4)
          this.renderSnapLine(
            [to[0] - FULL, to[1]],
            [to[0] + FULL, to[1]],
            api,
            snapContainer,
          );

          // (2)
          this.renderSnapLine(from, to, api, snapContainer);

          // Render distance label to the right of (3)
          const label = createSVGElement('text') as SVGTextElement;
          label.setAttribute('x', `${halfPoint[0] + 16}`);
          label.setAttribute('y', `${halfPoint[1]}`);
          label.setAttribute('text-anchor', 'start');
          label.setAttribute('dominant-baseline', 'middle');
          label.textContent = `${distance.toFixed(0)}`;
          label.setAttribute('fill', snapLineStroke);
          label.setAttribute('font-size', '12');
          snapContainer.appendChild(label);
        }
      }
    });
  }

  private renderSnapLine(
    from: [number, number],
    to: [number, number],
    api: API,
    snapContainer: SVGSVGElement,
  ) {
    const { snapLineStroke, snapLineStrokeWith } = api.getAppState();
    const line = createSVGElement('line') as SVGLineElement;

    line.setAttribute('x1', `${from[0]}`);
    line.setAttribute('y1', `${from[1]}`);
    line.setAttribute('x2', `${to[0]}`);
    line.setAttribute('y2', `${to[1]}`);
    line.setAttribute('stroke', snapLineStroke);
    line.setAttribute('stroke-width', `${snapLineStrokeWith}`);
    snapContainer.appendChild(line);
  }
}
