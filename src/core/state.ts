/**
 * The URL hash (spec/embed-protocol.md §1): v=1&d=<lz>&id=&step=&theme=&lint=&qa=&tools=.
 * Always URLSearchParams: lz-string's alphabet has "+" and "$", which a hand-built string breaks.
 */
import LZString from "lz-string";

export type Theme = "auto" | "light" | "dark";

export interface HashState {
  v: number | null;
  /** the diagram text, or null when d is missing or undecodable */
  d: string | null;
  id: string;
  step: number | "all";
  theme: Theme;
  lint: boolean;
  qa: boolean;
  tools: boolean;
  /** d was present but could not be decoded */
  undecodable: boolean;
}

export function compress(ksd: string): string {
  return LZString.compressToEncodedURIComponent(ksd);
}

export function decompress(d: string): string | null {
  try {
    const s = LZString.decompressFromEncodedURIComponent(d);
    return typeof s === "string" && s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

export function parseHash(hash: string): HashState {
  const p = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const vRaw = p.get("v");
  const v = vRaw === null ? null : /^[0-9]+$/.test(vRaw) ? parseInt(vRaw, 10) : NaN;
  const dRaw = p.get("d");
  const d = dRaw === null || dRaw === "" ? null : decompress(dRaw);
  const stepRaw = p.get("step") ?? "0";
  const step: number | "all" = stepRaw === "all" ? "all" : /^[0-9]+$/.test(stepRaw) ? parseInt(stepRaw, 10) : 0;
  const themeRaw = p.get("theme");
  const theme: Theme = themeRaw === "light" || themeRaw === "dark" ? themeRaw : "auto";
  const flag = (k: string, dflt: boolean) => (p.has(k) ? p.get(k) === "1" : dflt);
  const qa = flag("qa", false);
  return {
    v, d, id: p.get("id") ?? "", step, theme, lint: flag("lint", false) || qa, qa, tools: flag("tools", true),
    undecodable: dRaw !== null && dRaw !== "" && d === null,
  };
}

export interface HashInput {
  d: string;
  id?: string;
  step?: number | "all";
  theme?: Theme;
  lint?: boolean;
  qa?: boolean;
  tools?: boolean;
}

/** Build the hash (without the leading "#"), writing only non-default values after v and d. */
export function buildHash(s: HashInput): string {
  const p = new URLSearchParams({ v: "1", d: compress(s.d) });
  if (s.id) p.set("id", s.id);
  if (s.step !== undefined && s.step !== 0) p.set("step", String(s.step));
  if (s.theme && s.theme !== "auto") p.set("theme", s.theme);
  if (s.lint) p.set("lint", "1");
  if (s.qa) p.set("qa", "1");
  if (s.tools === false) p.set("tools", "0");
  return p.toString();
}
