/**
 * The draw toolbar's own small glyphs: a few pen strokes each, drawn here for Chalk, in currentColor.
 * They sit beside a word on wide screens and stand for it (with the word as the accessible name) when
 * the toolbar is short of room. Not an icon pack: there are only as many as the toolbar needs.
 */
import { svg } from "./dom";

const PATHS: Record<string, string> = {
  pointer: "M5 3 L5 16 L8.6 12.6 L11 18 L13.4 17 L11 11.6 L16 11.4 Z",
  undo: "M7.5 5.5 L3.5 9.5 L7.5 13.5 M4 9.5 H12.5 C15 9.5 16.5 11.2 16.5 13.4 C16.5 15.6 15 17 12.5 17 H10",
  redo: "M12.5 5.5 L16.5 9.5 L12.5 13.5 M16 9.5 H7.5 C5 9.5 3.5 11.2 3.5 13.4 C3.5 15.6 5 17 7.5 17 H10",
  minus: "M4.5 10 H15.5",
  plus: "M4.5 10 H15.5 M10 4.5 V15.5",
  fit: "M3.5 7.5 V3.5 H7.5 M12.5 3.5 H16.5 V7.5 M16.5 12.5 V16.5 H12.5 M7.5 16.5 H3.5 V12.5 M7 7 H13 V13 H7 Z",
  grid: "M5 5 h0.01 M10 5 h0.01 M15 5 h0.01 M5 10 h0.01 M10 10 h0.01 M15 10 h0.01 M5 15 h0.01 M10 15 h0.01 M15 15 h0.01",
  tidy: "M3 4 H8 V8 H3 Z M12 12 H17 V16 H12 Z M5.5 8 V14 H12 M12 4 H17 V8 H12 Z M8 6 H12",
  shapes: "M3.5 3.5 H10 V10 H3.5 Z M14 3.6 A3.3 3.3 0 1 1 13.99 3.6 M7 12.5 L10.5 17 H3.5 Z M12 13 H17 V17 H12 Z",
  panel: "M3 3.5 H17 V16.5 H3 Z M12 3.5 V16.5 M13.8 7 H15.4 M13.8 10 H15.4 M13.8 13 H15.4",
  more: "M4.5 10 h0.01 M10 10 h0.01 M15.5 10 h0.01",
  check: "M3.5 10.5 L8 15 L16.5 5",
  flag: "M5 17.5 V3 M5 3.5 H15 L12.5 7 L15 10.5 H5",
  close: "M5 5 L15 15 M15 5 L5 15",
  pencil: "M4 16 L4.6 12.6 L13 4.2 L15.8 7 L7.4 15.4 Z M11.6 5.6 L14.4 8.4",
  trash: "M4 6 H16 M8 6 V4 H12 V6 M6 6 L7 16.5 H13 L14 6 M8.7 9 V14 M11.3 9 V14",
  swap: "M4 7 H15 M12 4 L15 7 L12 10 M16 13 H5 M8 10 L5 13 L8 16",
  focus: "M10 3 V6 M10 14 V17 M3 10 H6 M14 10 H17 M10 7 A3 3 0 1 1 9.99 7",
};

export function icon(name: keyof typeof PATHS | string): SVGSVGElement {
  const out = svg("svg", { class: `ui-icon ui-icon-${name}`, viewBox: "0 0 20 20", width: 20, height: 20, focusable: "false" });
  out.setAttribute("aria-hidden", "true");
  out.appendChild(svg("path", { d: PATHS[name] ?? "" }));
  return out;
}
