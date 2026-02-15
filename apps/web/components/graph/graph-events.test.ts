import { describe, test, expect, mock } from 'bun:test';
import { bindCyEvents } from './graph-events';

describe('bindCyEvents', () => {
  test('registers handlers and unregisters exactly the same handlers on cleanup', () => {
    const on = mock(() => {});
    const off = mock(() => {});

    const cy = { on, off } as any;

    const handlers = {
      onTapNode: mock(() => {}),
      onTapEdge: mock(() => {}),
      onTapBackground: mock(() => {}),
      onDblTapNode: mock(() => {}),
      onMouseOverNode: mock(() => {}),
      onMouseOutNode: mock(() => {}),
      onMouseOverEdge: mock(() => {}),
      onMouseOutEdge: mock(() => {}),
      onGrabNode: mock(() => {}),
      onDragNode: mock(() => {}),
      onFreeNode: mock(() => {}),
    };

    const cleanup = bindCyEvents(cy, handlers);

    expect(on).toHaveBeenCalledTimes(11);

    cleanup();

    expect(off).toHaveBeenCalledTimes(11);

    // First registration pair must match same event tuple + callback reference
    expect(off.mock.calls[0]?.[0]).toBe(on.mock.calls[0]?.[0]);
    expect(off.mock.calls[0]?.[1]).toBe(on.mock.calls[0]?.[1]);
    expect(off.mock.calls[0]?.[2]).toBe(on.mock.calls[0]?.[2]);
  });
});
