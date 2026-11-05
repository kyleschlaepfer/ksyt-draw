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
      app.open(f.source, `open ${name}`, f.identities);
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

  const typeDialog = el("dialog", "type-dialog");
  typeDialog.setAttribute("aria-labelledby", "new-diagram-title");
  const typeHead = el("div", "type-dialog-head");
  const typeTitle = el("h2", undefined, "new diagram");
  typeTitle.id = "new-diagram-title";
  const typeClose = button("btn-quiet", "cancel", "keep the current diagram");
  typeClose.addEventListener("click", () => typeDialog.close());
  typeHead.append(typeTitle, typeClose);
  typeDialog.append(typeHead, el("p", "note", "Choose the notation first. You can place empty shapes and fill them in whenever you are ready."));
  const typeChoices = el("div", "type-choices");
  for (const t of TEMPLATES) {
    const choice = button("type-choice", t.label, t.hint);
    choice.setAttribute("role", "menuitem");
    choice.dataset.type = t.key;
    const preview = el("span", `type-preview type-preview-${t.key}`);
    preview.setAttribute("aria-hidden", "true");
    const words = el("span", "type-choice-words");
    words.append(el("strong", undefined, t.label), el("span", "note", t.hint));
    choice.replaceChildren(preview, words);
    choice.addEventListener("click", () => {
      typeDialog.close();
      app.open(t.text, `new ${t.label}`);
      app.showTab("draw");
      say(`started a blank ${t.label}; undo brings back what was here`);
    });
    typeChoices.appendChild(choice);
  }
  typeDialog.appendChild(typeChoices);
  typeDialog.addEventListener("click", (ev) => { if (ev.target === typeDialog) typeDialog.close(); });
  const newBtn = button("btn-quiet", "new");
  newBtn.id = "new-diagram";
  newBtn.setAttribute("aria-haspopup", "dialog");
  newBtn.addEventListener("click", () => typeDialog.showModal());
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
  root.append(newBtn, openBtn, saveBtn, exportBtn, picker, typeDialog);

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
