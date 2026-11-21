import { describe, expect, it } from "vitest";
import trackerData from "../../tracker/items.json";

const VALID_KINDS = new Set(["feature", "bug", "issue"]);
const VALID_STATUSES = new Set(["backlog", "todo", "doing", "done"]);
const VALID_PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const VALID_MILESTONES = new Set(["M0", "M1", "M2", "M3", "M4", "M5", "M6", "—"]);

function expectedSpecIds(): string[] {
  const counts: Array<[number, number]> = [
    [0, 4],
    [1, 30],
    [2, 6],
    [3, 4],
    [4, 9],
    [5, 4],
    [6, 7],
  ];
  const ids: string[] = [];
  for (const [m, count] of counts) {
    for (let i = 1; i <= count; i++) {
      ids.push(`F${m}.${i}`);
    }
  }
  return ids;
}

describe("repo tracker dataset (tracker/items.json)", () => {
  it("contains all 64 SPEC.md features with valid schema and unique IDs", () => {
    const specIds = expectedSpecIds();
    expect(specIds).toHaveLength(64);

    expect(trackerData.schemaVersion).toBe(1);
    expect(trackerData.project).toBe("RosForge");
    expect(Array.isArray(trackerData.items)).toBe(true);

    const seenIds = new Set<string>();
    for (const item of trackerData.items) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(seenIds.has(item.id)).toBe(false);
      seenIds.add(item.id);

      expect(item.title.length).toBeGreaterThan(0);
      expect(item.title.length).toBeLessThanOrEqual(200);
      expect(VALID_KINDS.has(item.kind)).toBe(true);
      expect(VALID_MILESTONES.has(item.milestone)).toBe(true);
      expect(VALID_STATUSES.has(item.status)).toBe(true);
      expect(VALID_PRIORITIES.has(item.priority)).toBe(true);
      expect(item.spec.length).toBeLessThanOrEqual(20);
      expect(item.note.length).toBeLessThanOrEqual(2000);
      expect(typeof item.order).toBe("number");
      expect(typeof item.createdAt).toBe("number");
      expect(typeof item.updatedAt).toBe("number");
    }

    const trackerSpecIds = new Set(
      trackerData.items.map((i) => i.spec).filter(Boolean)
    );
    for (const specId of specIds) {
      expect(trackerSpecIds.has(specId), `missing spec feature ${specId}`).toBe(true);
    }
  });
});
