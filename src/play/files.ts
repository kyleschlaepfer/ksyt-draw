/**
 * The document bar: new, open, save, export. It sits at the end of the views row so it is there in
 * every view. Nothing here talks to a server; files go through the browser's own open and download.
 */
import { ProjectError, openFile, toProject } from "../core/doc/project";
import { saveBlob } from "../export/save";
import { button, el, menuButton, type App } from "./app";
import { TEMPLATES } from "./templates";
import { loadPrevious } from "./storage";

export interface FilesBar { root: HTMLElement; openText(text: string, name: string): void }

export function mountFiles(app: App, say: (msg: string) => void, openExport: () => void): FilesBar {
  const root = el("div", "doc-bar");
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "document");

  const openText = (text: string, name: string): void => {
    try {
      const f = openFile(text);
      if (f.workspace.view) app.workspace.view = f.workspace.view;
      if (f.workspace.export) app.workspace.export = f.workspace.export;
      app.open(f.source, `open ${name}`);
      say([`opened ${name}`, ...f.notes].join("; ") + " (undo brings back what was here)");
    } catch (e) {
      say(e instanceof ProjectError ? e.message : `couldn't open ${name}`);
    }
  };

  const picker = el("input");
  picker.type = "file";
  picker.accept = ".ksd,.json,.txt,text/plain,application/json";
  picker.hidden = true;
  picker.setAttribute("aria-hidden", "true");
  picker.tabIndex = -1;
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    if (file.size > 4_000_000) { say(`${file.name} is too big to be a diagram`); return; }
    file.text().then((t) => openText(t, file.name), () => say(`couldn't read ${file.name}`));
  });

  const newBtn = menuButton(button("btn-quiet", "new"), () => TEMPLATES.map((t) => ({
    label: t.label, hint: t.hint,
    run: () => { app.open(t.text, `new ${t.label}`); say(`started a new ${t.label} (undo brings back what was here)`); },
  })));
  const openBtn = menuButton(button("btn-quiet", "open"), () => {
    const prev = loadPrevious();
    return [
      { label: "a file from this computer", hint: ".ksd text or a .chalk.json project", run: () => picker.click() },
      { label: "the diagram you had before", hint: prev ? "kept in this browser" : "nothing kept yet", disabled: !prev || prev.text === app.session.text, run: () => { if (prev) openText(prev.text, "your earlier diagram"); } },
    ];
  });
  const saveBtn = menuButton(button("btn-quiet", "save"), () => {
    const valid = app.session.inSync && !!app.session.doc;
    const id = app.session.doc?.meta.id || "diagram";
    return [
      {
        label: "project file", hint: valid ? `${id}.chalk.json: the text, the model and this workspace` : "fix the text first", disabled: !valid,
        run: () => {
          const proj = toProject(app.session.parsed, app.workspace);
          saveBlob(new Blob([JSON.stringify(proj, null, 1) + "\n"], { type: "application/json" }), `${id}.chalk.json`);
          say(`saved ${id}.chalk.json`);
        },
      },
      {
        label: "diagram text", hint: `${id}.ksd: the whole diagram as text`,
        run: () => { saveBlob(new Blob([app.session.text], { type: "text/plain" }), `${id}.ksd`); say(`saved ${id}.ksd`); },
      },
    ];
  });
  const exportBtn = button("btn-quiet", "export", "a picture for a slide, a report or a page");
  exportBtn.id = "open-export";
  exportBtn.addEventListener("click", openExport);
  root.append(newBtn, openBtn, saveBtn, exportBtn, picker);

  // dropping a file anywhere on the page opens it
  window.addEventListener("dragover", (ev) => { if (ev.dataTransfer?.types.includes("Files")) ev.preventDefault(); });
  window.addEventListener("drop", (ev) => {
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    ev.preventDefault();
    if (file.size > 4_000_000) { say(`${file.name} is too big to be a diagram`); return; }
    file.text().then((t) => openText(t, file.name), () => say(`couldn't read ${file.name}`));
  });

  return { root, openText };
}
