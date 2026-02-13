import { field, Type } from '@lastolivegames/becsy';

/**
 * Highlight the object when hovering or brush selecting.
 */
export class Highlighted {
  /**
   * Stroke width of the highlight border.
   * - `2` for hover highlight (default)
   * - `1` for brush (marquee) selection highlight
   */
  @field({ type: Type.float32, default: 2 }) declare strokeWidth: number;

  constructor(props?: Partial<Highlighted>) {
    Object.assign(this, props);
  }
}
