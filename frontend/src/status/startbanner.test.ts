import { expect, test } from "vitest";
import { initialState } from "../state/app";
import { sessionFixture } from "../testing/fixtures";
import { startBanner } from "./startbanner";

test("UI-146 before a file is open the banner says how to start and why the panels are inert; none once open", () => {
  const b = startBanner(initialState())!;
  expect(b.title).toBe("Open a PCD to start");
  expect(b.reason).toMatch(/disabled until a file is open/i);
  expect(startBanner({ ...initialState(), session: sessionFixture() })).toBeNull();
});
