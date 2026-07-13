export const ENTRY_HOLD_MS = 500;
export const ENTRY_HOLD_SLOP_PX = 12;

export interface PressPoint {
  pointerId: number;
  x: number;
  y: number;
  eligible: boolean;
}

export interface PressHoldOptions {
  holdMs: number;
  slopPx: number;
  onPrime?: (point: PressPoint) => void;
  onPendingChange?: (point: PressPoint | null) => void;
  onCommit: (point: PressPoint) => void;
}

export interface PressHold {
  down(point: PressPoint): boolean;
  move(point: PressPoint): void;
  up(pointerId: number): void;
  cancel(pointerId: number): void;
  scroll(): void;
  dispose(): void;
}

interface PendingHold {
  point: PressPoint;
  timer: ReturnType<typeof setTimeout>;
}

export function createPressHold(options: PressHoldOptions): PressHold {
  let pending: PendingHold | null = null;

  const clear = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
    options.onPendingChange?.(null);
  };

  const down = (point: PressPoint) => {
    if (!point.eligible || pending) return false;
    options.onPrime?.(point);
    const timer = setTimeout(() => {
      const current = pending;
      if (!current || current.point.pointerId !== point.pointerId) return;
      pending = null;
      options.onPendingChange?.(null);
      options.onCommit(current.point);
    }, options.holdMs);
    pending = { point, timer };
    options.onPendingChange?.(point);
    return true;
  };

  const move = (point: PressPoint) => {
    if (!pending || pending.point.pointerId !== point.pointerId) return;
    const distance = Math.hypot(point.x - pending.point.x, point.y - pending.point.y);
    if (distance > options.slopPx) clear();
  };

  const cancelPointer = (pointerId: number) => {
    if (pending?.point.pointerId === pointerId) clear();
  };

  return {
    down,
    move,
    up: cancelPointer,
    cancel: cancelPointer,
    scroll: clear,
    dispose: clear,
  };
}
