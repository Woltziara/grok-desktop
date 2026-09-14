import assert from "node:assert/strict";
import { test } from "node:test";
import { pickResumeTimeline } from "../shared/resume-timeline.mjs";

test("a live parked turn keeps the in-memory tail", () => {
  const disk = [{ id: "1" }];
  const cached = [{ id: "1" }, { id: "2" }, { id: "3" }];
  assert.equal(pickResumeTimeline(disk, cached, true), cached);
});

test("empty cache falls back to disk", () => {
  const disk = [{ id: "1" }];
  assert.equal(pickResumeTimeline(disk, [], false), disk);
  assert.deepEqual(pickResumeTimeline(disk, null, true), disk);
});

test("idle resume keeps the longer cache", () => {
  const disk = [{ id: "1" }];
  const cached = [{ id: "1" }, { id: "2" }];
  assert.equal(pickResumeTimeline(disk, cached, false), cached);
  assert.equal(pickResumeTimeline(cached, disk, false), cached);
});
