import { expect, test } from "vitest";
import { editShapeState } from "./shape";
import { EDIT_SHAPE_UNAVAILABLE, LAYER_STEP_TITLE } from "./shape";

const e = (extra: object) => ({ index: 0, kind: "delete", description: "", count: 1, sid: 5, ...extra });

test("UI-865 a selection step with no shape says it was selected from a layer, not that it is old; other shapeless steps keep the generic text", () => {
  const sel = editShapeState(e({ tool: "selection", shape: null }) as never, 1);
  expect(sel.enabled).toBe(false);
  expect(sel.title).toBe(LAYER_STEP_TITLE);
  expect(LAYER_STEP_TITLE).toMatch(/selected from a layer/);
  expect(editShapeState(e({ tool: "box", shape: null }) as never, 1).title).toBe(EDIT_SHAPE_UNAVAILABLE);
  expect(editShapeState(e({ shape: null }) as never, 1).title).toBe(EDIT_SHAPE_UNAVAILABLE);
});

test("UI-935 Edit shape on a layer step is disabled with its own title", () => {
  const s = editShapeState(e({ tool: "layer", shape: null }) as never, 1);
  expect(s.enabled).toBe(false);
  expect(s.title).toBe("A layer edit has no shape to edit");
});
