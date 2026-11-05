import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDoc as parse } from "../src/core/doc/parse";
import { describeItems, describeText } from "../src/core/describe";

const load = (f: string) => parse(readFileSync(new URL("../fixtures/" + (f.includes("/") ? f : "diagrams/" + f), import.meta.url), "utf8"));

describe("describe.ts", () => {
  it("flow-approval reads as numbered steps with the decision's exits", () => {
    const d = load("flow-approval.ksd");
    expect(describeItems(d)).toMatchInlineSnapshot(`
      {
        "intro": "Flowchart.",
        "items": [
          "start",
          "submit request",
          "review request",
          "approved? yes: schedule the work (step 5). no: notify requester (step 6)",
          "schedule the work",
          "notify requester",
          "end",
        ],
        "ordered": true,
      }
    `);
    expect(describeText(d)).toBe(d.meta.desc);
  });
  it("activity-parallel folds the fork and join", () => {
    const d = load("activity-parallel.ksd");
    d.meta.desc = "";
    expect(describeItems(d).items).toMatchInlineSnapshot(`
      [
        "start",
        "accept offer",
        "at the same time: order laptop; print badge",
        "when both are done: first day",
        "end",
      ]
    `);
    expect(describeText(d)).toBe("Activity diagram. Start. Accept offer. At the same time: order laptop; print badge. When both are done: first day. End.");
  });
  it("usecase-permit lists actors, includes and extends", () => {
    const d = load("usecase-permit.ksd");
    expect(describeItems(d)).toMatchInlineSnapshot(`
      {
        "intro": "Use-case diagram for Permit portal.",
        "items": [
          "Resident: apply for permit, track status",
          "Permit clerk: review application",
          "apply for permit always includes pay fee",
          "request fee waiver sometimes extends pay fee",
        ],
        "ordered": false,
      }
    `);
  });
  it("dangling: the unknown target is left out and the title still has a description", () => {
    const d = load("dangling.ksd");
    expect(describeText(d)).toBe("Flowchart. Start. Review request. End.");
  });
  it("unlabeled exits and unconnected nodes are said plainly", () => {
    const d = load("flow-unlabeled.ksd");
    const items = describeItems(d).items;
    expect(items[2]).toBe("approved? unlabeled: schedule the work (step 4). unlabeled: notify requester (step 5)");
    const loose = parse("diagram flowchart\ntitle t\nstart s\nprocess a\nprocess b\nend e\ns -> a\na -> e\nnote n \"aside\"");
    expect(describeItems(loose).items).toEqual(["start", "a", "end", "b (not connected)", "note: aside"]);
  });
  it("partitions are named in the intro and beside each step, never listed as steps", () => {
    const d = load("v2/activity-lanes.ksd");
    const r = describeItems(d);
    expect(r.intro).toBe("Activity diagram with 3 partitions: Customer, Sales, Warehouse.");
    expect(r.items[1]).toBe("place order (Customer)");
    expect(r.items.some((s) => s.startsWith("Customer") || s.startsWith("Sales"))).toBe(false);
    expect(r.items.find((s) => s.startsWith("payment cleared?"))).toBe("payment cleared? (Sales) [yes]: pack order (Warehouse) (step 6). [no]: cancel order (Sales) (step 7)");
  });
  it("a class diagram reads as classifiers with their members, then relationships with multiplicities", () => {
    const shapes = describeItems(load("v2/class-shapes.ksd"));
    expect(shapes.intro).toBe("Class diagram.");
    expect(shapes.items).toContain("interface Drawable: operations +draw(canvas: Canvas): void");
    expect(shapes.items).toContain("abstract class Shape: attributes #origin: Point; operations +area(): float {abstract}, +moveTo(p: Point): void");
    expect(shapes.items).toContain("Shape implements Drawable");
    expect(shapes.items).toContain("Circle is a kind of Shape");
    const orders = describeItems(load("v2/class-orders.ksd")).items;
    expect(orders).toContain("1 Customer places 0..* Order");
    expect(orders).toContain("1 Order is composed of 1..* LineItem (contains)");
    expect(orders).toContain("1 Catalog has 0..* Product (lists)");
  });
});
