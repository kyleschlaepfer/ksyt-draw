# Chalk: user guide

Chalk makes use-case, activity, class and flow diagrams. You can write a diagram as a few lines of text, or draw it on a canvas, or both: the two views edit the same diagram. Shapes are predefined. Nobody draws freehand.

Everything runs in your browser. Nothing is sent to a server, and there is no account.

Contents: [start](#1-start-the-app) · [the page](#2-the-page) · [write](#3-write) · [draw](#4-draw) · [swimlanes](#5-swimlanes) · [class diagrams](#6-class-diagrams) · [use-case descriptions](#7-use-case-descriptions) · [the checks](#8-reading-the-checks) · [save and open](#9-save-open-the-local-draft-and-the-link) · [export](#10-export) · [embed](#11-embedding) · [keyboard](#12-keyboard-shortcuts)

## 1. Start the app

From the repo:

```
npm install
npm run dev
```

Open the address Vite prints (`http://localhost:5173` unless that port is taken). The deployed copy lives at `https://chalk.kyleschlaepfer.com`.

The first time, the page opens with an example use-case diagram. After that it opens with whatever you had last.

## 2. The page

One row holds the three views and the document's actions.

| Views | |
|---|---|
| write | the diagram as text, with the figure beside it |
| draw | the same diagram on a canvas |
| the syntax | the full reference for the text format, with examples you can load |

| Document | |
|---|---|
| new | choose a type and start with a blank flowchart, activity, use-case or class canvas |
| open | a file from this computer, or the diagram you had before |
| save | a project file, or the diagram text |
| export | a picture for a slide, a report or a page |

The footer has the theme switch: light, dark, system.

## 3. Write

The left side is the editor, labeled "diagram text". The right side is the figure. The figure is redrawn a moment after you stop typing.

A diagram starts like this:

```
diagram flowchart
title After review, a request takes one of two paths

start begin
process review "review the request"
decision ok "approved?"
process schedule "schedule the work"
process notify "notify the requester"
end done

begin -> review
review -> ok
ok -> schedule : yes
ok -> notify : no
schedule -> done
notify -> done
```

The first line names the type. `title` says what the diagram shows. Then come the shapes, one per line (`kind id "label"`), then the lines between them (`a -> b : label`). The view called "the syntax" has every kind and operator.

### Completions

The editor offers what fits where the cursor is:

- on the first line, `diagram` and the four types;
- in the header, the header words (`title`, `id`, `direction`, `look` and the rest);
- at the start of a line, the shapes for this diagram type, `step`, `layout {`, and the ids you have declared;
- after an id, the operators for this diagram type;
- after an operator, the ids you have declared;
- inside `describe { }` and `layout { }`, the words that belong there.

They appear as you type. Ctrl+Space asks for them.

### Find and replace

Press "find" or Ctrl+F. The panel opens at the top of the editor, with replace beside find.

### Tidy

Press "tidy" or Shift+Alt+F. Every line is put in its standard form. Comments and the order of your lines stay. If nothing needs changing, the status line says "already tidy".

### The figure follows the cursor

- The shape or line that the cursor's line declares is marked in the figure.
- Click a shape or a line in the figure and the editor goes to the line that declares it.

### When the text has a mistake

- Every bad line is underlined, not only the first. Point at the mark in the gutter to read the message.
- The status line under the editor shows the first one: "line 7: unknown kind 'proces'".
- The figure does not go blank. It keeps the last version that worked, with a note above it: "the text has a mistake on line 7, so this is the last version that worked".
- Draw goes read-only until the text is fixed.
- Export uses the last version that worked.
- "save" still saves the diagram text. The project file waits until the text is fixed.

### Under the editor

| Button | Does |
|---|---|
| copy embed code | copies an iframe snippet for any web page |
| copy link | copies a link to this page that holds the diagram |
| copy for the site | copies the import line and the `<DiagramEmbed>` line for kyleschlaepfer.com |
| download SVG | saves the figure as it looks now |

The status line under them says what the diagram is and how its checks went: "Use-case diagram, 8 nodes, 7 edges, notation check: pass".

## 4. Draw

The draw view fills the window. One row of tools runs across the top, with the diagram type and title; the shape and line library is on the left ("shapes" shows or hides it); the canvas takes the rest; the properties open on the right when you ask for them ("properties"); and a status strip along the bottom says what just happened, with the notation check's count at its right. A selected shape or line gets a small bar of its everyday actions beside it. "Start another kind of diagram", under "more", starts another blank diagram rather than converting or dropping the current diagram's objects.

Everything you do here is written into the text. Switch to write at any time to see it.

### Place a shape

Three ways:

- **Drag** a shape from the list onto the canvas.
- **Click** a shape in the library, then click the canvas wherever each copy goes. The tool stays armed so you can lay out several empty shapes. Escape, Select, or another tool stops it.
- **Keyboard:** focus a shape in the list and press Enter or Space. It lands in the middle of the view.

The list changes with the diagram type. A shape dropped on a partition or a boundary joins it.

### Select

- Click a shape or a line.
- Shift+click adds to the selection or takes away from it.
- Hold Shift and drag on empty canvas to select with a box; it adds to what is selected. (A plain drag on empty canvas moves the view, and a plain click there clears the selection.)
- Ctrl+A selects every shape and line.
- Escape clears the selection.

### Move

- Drag a shape. Several selected shapes move together.
- While you drag, the shape lines up with its neighbours and guides show where.
- "snap to grid" in the toolbar keeps shapes on an eighth-inch grid.
- Hold Alt to place freely.
- The arrow keys nudge the selection by 0.05 in. With "snap to grid" on they move one grid step. With Shift they move 0.25 in.
- A shape dragged into a partition or boundary joins it; dragged out, it leaves. The status line says which.

### Resize

Select one shape and drag a handle. A fork or join bar has two handles, for its length. Hold Alt to resize from the center. A shape cannot get smaller than its text needs.

The start dot, the end marks, the merge diamond and the actor have one size.

### Edit text in place

- Double-click a shape or a line's label. Or select it and press Enter or F2. Or select it and just start typing, which replaces the text.
- Enter keeps the change. Shift+Enter starts a new line in a shape's text. Escape gives up.
- In a class, double-click the name or a member row.
- With a class selected, use the `+ attribute` and `+ operation` actions below it. Alt+A and Alt+O do the same from the keyboard; the new row opens for inline editing.
- A start dot, an end mark, a fork, a join and a merge have no text.

### Connect

Two routes:

1. Point at a shape, then drag one of its side dots to another shape; or
2. Choose a relationship in the left library, then choose its source and target. With the canvas focused, arrow keys select the first shape, Enter chooses it, Tab moves to the next shape, and Enter completes the line.

- The relationship library is scoped to the diagram type. The smaller "dragging from a dot makes" choice changes what a dot drag creates. Left alone, it is the usual relationship for the two shapes: an arrow in a flow, an association from an actor to a use case, «include» between two use cases, a realization from a class to an interface.
- A new line out of a decision opens its label at once, because every exit of a decision needs one.
- A line may return to the same shape; it is drawn as a loop.
- Notation mistakes are not refused. The line remains on the canvas and in the saved document, while the notation check's count at the right of the status strip (for example "1 notation warning") opens a list that explains the issue and offers "show it", which selects the part and brings it into view. Missing objects, broken source text, and other technical failures still block an edit.

### Reconnect

Select a line. Drag the circle at either end to another shape.

### Bend a line

Select a line. Its handles appear.

- Drag a handle on a run of an elbow line to slide that run.
- Drag a dot in the middle of a run to add a bend there.
- Drag a bend to move it.
- Double-click a bend to remove it.
- "reset route" in the panel hands the line back to the router.

### Move a label

Drag a line's label. "reset label" in the panel puts it back where the layout would.

### The properties panel

The panel shows what is selected.

| Selected | The panel shows |
|---|---|
| nothing | **diagram**: the current type, title, id, which way it runs, drawn as (sketch or precision). Under "more": checked as, narration, the text alternative. Use "start another kind of diagram" under "more" to start another notation |
| one shape | its kind, text, id; where it is inside; x, y, width and height in inches; build-up (the step it shows from); look (fill, color, weight); delete |
| an actor | also which side it stands on |
| a class or interface | also its attributes and operations, stereotype, abstract |
| a use case | also its description |
| a partition | who, width or height, move left and right (or up and down), duplicate, delete |
| one line | what it means, its label, its route, build-up, look, swap ends, delete. In a class diagram: how many and the role at each end |
| several things | align, space evenly, same size, build-up, duplicate, delete |

A field takes effect when you press Enter or leave it.

A line's pattern and its ends are part of what it means. To make a line dashed or give it a triangle, change "what it means".

Colors come from the theme: ink, graphite, green, dark green, terracotta. There are no colors of your own.

"build-up" holds "shows from step": the click of "next step" at which the selection first appears in an embed. 0 is there from the start. Changing it writes a `step` line before the shape or line in the text, puts the earlier step back for the lines after it, and touches nothing else. With several things selected the field sets them all.

### Align and distribute

Select two or more shapes.

- **align:** left, center, right, top, middle, bottom.
- **space evenly:** across or down. Needs three or more.
- **same size:** width or height.

Each is one step to undo.

### Copy, paste, duplicate

- Ctrl+C copies the selected shapes and the lines between them. Ctrl+X cuts. Ctrl+V pastes. Ctrl+D duplicates.
- Copies get new ids.
- The clipboard is Chalk's own and lasts while the page is open. It does not go to other programs.

### Undo and redo

"undo" and "redo" in the toolbar, or Ctrl+Z and Ctrl+Y (also Ctrl+Shift+Z). Write and draw share one history, so undo steps back through both in the order things happened.

The keys work anywhere in the draw view: on the canvas, and after a click on a button or a choice in the properties panel or the palette. While you type in a text field they undo the typing in that field, as they do everywhere else.

### Zoom and pan

- Toolbar: zoom out, the zoom figure (click for actual size), zoom in, "fit".
- Ctrl+wheel, or a pinch on a trackpad, zooms about the pointer. The range is 20% to 400%.
- Drag empty canvas to pan. Holding Space, a drag anywhere on the canvas pans, shapes included; so does a drag with the middle button. Escape during a pan puts the view back.
- The wheel pans; Shift+wheel pans sideways.
- From the keyboard, Ctrl+arrow keys pan (Shift for a bigger step).
- Panning only moves the view: nothing in the diagram moves, and nothing is saved to the text.

### What "placed" means

Chalk lays the diagram out for you. Each shape is one of two things:

- **Placed for you.** It follows the layout. Add something and it may be given a new spot.
- **Placed by hand.** You dragged it, so it stays where you put it until you move it or let it go.

When you change one thing, the other shapes hold still. To make that true, any shape the layout would have shifted is pinned where it already was. The status line tells you: "3 others stay put".

There is one thing that does move. If your change leaves two shapes too close together (a class that grew into the one below it, a new line with a label between two shapes that sat side by side), the neighbour is pushed over just far enough, and the status line says "made room: 1 shape moved over". Shapes you put close together yourself are left alone.

The panel says which a shape is, and, with nothing selected, how many shapes and lines are yours.

To hand a shape back: select it and press "let it find its own place". A size set by hand goes back with "fit to its text".

Positions set by hand are kept in the text, in a `layout { }` block at the end. Deleting a line there hands that part back too.

### Tidy up

"tidy up" in the toolbar hands things back to the automatic layout:

- **the whole diagram:** everything placed, sized or routed by hand;
- **what is selected;**
- **only the lines:** every route and label position.

You see the result before it is kept. Press "keep it" or "put it back". Escape puts it back. Undo also brings back the way you had it.

### When draw is read-only

If the text has a mistake, the canvas shows the last version that worked and nothing can be changed. A banner says so, with a "fix it in write" button.

## 5. Swimlanes

A partition is a swimlane: it says who does the actions inside it. Partitions belong to activity diagrams and flowcharts.

In text:

```
diagram activity
title The clerk checks; the system files

partition clerk "Clerk" {
  start begin
  action check "check the form"
}
partition system "System" {
  action file "file the application"
  end done
}

begin -> check
check -> file
file -> done
```

- Lanes appear in the order they are written.
- Lanes are columns when the flow runs down, and rows when it runs right. `lanes horizontal` or `lanes vertical` in the header sets it directly.
- Partitions do not nest.

In draw:

- Choose “activity diagram” in New, then place as many empty partitions as you need.
- “partition” is in the graphical shape library.
- Drag a shape into a lane, or drop a new one on it.
- Drag the line at a lane's far edge to make that lane thicker or thinner.
- Select a lane by its header. The panel has its name ("who"), its width or height, move left and move right (move up and move down for rows), duplicate and delete.
- Deleting a partition keeps its shapes, outside any partition.

The notation check looks at lanes: a node outside every partition, an empty partition, a single partition.

## 6. Class diagrams

In text:

```
diagram class
title A circle and a square are shapes that can be drawn

interface Drawable {
  +draw(canvas: Canvas)
}
abstract class Shape {
  #name: String
  +area(): Number {abstract}
}
class Circle {
  -radius: Number
}

Shape ..|> Drawable
Circle --|> Shape
Circle "1" o-- "0..*" Point
class Point
```

Members are one per line inside the braces: `+ name: Type` for an attribute, `+ name(params): Type` for an operation. The marks are `+` public, `-` private, `#` protected, `~` package. End a member with `{static}` or `{abstract}` when it is.

| Line | Means |
|---|---|
| `a -- b` | association |
| `a --> b` | association you can follow from a to b |
| `a --\|> b` | generalization: a is a kind of b |
| `a ..\|> b` | realization: a implements the interface b |
| `a o-- b` | aggregation: a has b |
| `a *-- b` | composition: a owns b |
| `a ..> b` | dependency |

A quoted text next to an end is how many (`1`, `0..1`, `*`, `1..*`) and, after it, a role name: `Order "1" *-- "1..* lines" OrderLine`.

In draw:

- Double-click a class's name or a member to edit it in place. Clearing a member's text removes it.
- The panel's "attributes and operations" lists each member with a field, an up arrow button to move it, and "remove". "add attribute" and "add operation" add one.
- "stereotype" and "abstract" are in the panel.
- Select a line to set "what it means", its name, and "how many" and "role there" at each end.

## 7. Use-case descriptions

A use case can carry a written description. It belongs to the diagram's text and is checked, but it is not drawn in the figure.

In text, after the use case is declared:

```
describe apply {
  goal The resident gets an application on file
  primary resident
  trigger The resident opens the portal
  pre The resident has an account
  main The resident fills in the form
  main The portal checks the form
  alt The form is incomplete: the portal says what is missing
  post The application is on file
}
```

| Field | Holds |
|---|---|
| `goal` | what the actor wants |
| `primary` | the primary actor, by id or by name |
| `supporting` | supporting actors, one line each |
| `trigger` | the event that starts it |
| `pre` | preconditions, one line each |
| `main` | the main success scenario, one step per line |
| `alt` | alternate and exception flows, one line each |
| `post` | postconditions, one line each |
| `related` | related use cases, one line each |

In draw, select a use case and open "description" in the panel. Fill in what you know. Nothing is made up for you.

The notation check compares the description with the picture: a primary actor who is not in the diagram or not linked to the use case, a description with no main steps, a trigger repeated as a precondition.

## 8. Reading the checks

### The notation check

Every diagram is checked with the rules used on the videos' slides, plus rules for partitions, classes and descriptions. The result is a status and a list of findings.

| Status | Means |
|---|---|
| pass | no findings |
| pass with notes | only minor findings or suggestions |
| needs changes | at least one major finding |
| blocked | a critical finding: the diagram teaches the wrong notation |

- In write, the panel is under the figure. Each finding has its severity in words, a rule id, where it is, what is wrong, and the smallest fix. The same findings are underlined in the editor.
- In draw, the status line shows the status.
- The check never stops the drawing. A blocked diagram still draws.
- The panel's last line says which profile was used: "checked as uml-inspired". A stricter or looser profile is set with a `profile` line, or under "more" in the draw panel.

The view called "the syntax" lists every rule.

### The layout check

After drawing, the figure itself is checked.

| Code | Level | Means |
|---|---|---|
| `LINE_THROUGH_TEXT` | error | a stroke runs through or touches a label |
| `TEXT_OVERLAP` | error | two labels overlap |
| `CLIP` | error | ink or a label is outside the frame |
| `SMALL_KALAM` | warning | handwritten text under 18 px (not in the precision look) |
| `PHONE_LEGIBILITY` | warning | a label that would be under 13 px on a narrow screen |

It shows in write under the notation check, and in the export dialog for the picture you are about to save. A shorter label usually clears a collision. When it does not, drag the shape, the line or the label in draw.

## 9. Save, open, the local draft and the link

**The local draft.** The open diagram is saved in this browser a moment after each change. Close the tab, come back, and it is there. It lives in this browser only. If the browser refuses to store it, the status line says so.

**The link.** The address bar holds the diagram too, so the link can be shared. "copy link" copies it. A very long diagram does not fit in a link (the limit is 8,000 characters after compression). The link then stops carrying the diagram, and the local draft and a saved file still hold it.

Opening someone's link replaces your draft on screen. Your own diagram is kept: "open", then "the diagram you had before".

**save** has two choices:

| Choice | File | Holds |
|---|---|---|
| project file | `<id>.chalk.json` | the text, the model as JSON, and this workspace (the view and your export choices) |
| diagram text | `<id>.ksd` | the whole diagram as text, layout included |

Either one reopens as the same diagram. The `.ksd` file is plain text and is the one to keep in a repo.

**open** takes a `.ksd` file or a `.chalk.json` project. You can also drop a file anywhere on the page. A file over 4 MB is refused.

**new** opens the diagram-type chooser and starts a blank visual document.

New and open replace the diagram on screen, and undo brings back what was there.

## 10. Export

Press "export". The dialog shows the picture that will be saved, and a line with its size, its smallest text and the layout check for this picture.

| Group | Choices |
|---|---|
| format | **PNG**, a picture for slides, documents, anywhere. **SVG**, vector for web pages and design tools. **PDF**, vector for print and reports |
| drawn as | **sketch**, the pen style of the videos. **precision**, crisp lines for formal documents |
| background | white; off-white page; none (see-through); chalkboard |

Under "more":

| Group | Choices | For |
|---|---|---|
| space around it | tight, normal, roomy | all |
| PNG size | 1x, 2x (sharp on slides), 3x, 4x (print) | PNG |
| SVG text | letters, shapes | SVG |
| PDF page | the diagram's own size, US Letter, A4, 16:9 slide | PDF |
| which way up | landscape, portrait | PDF on a fixed page |

- **The two looks** show the same diagram: the same shapes in the same places with the same routes. Only the ink and the font differ. The dialog starts with the diagram's own look.
- **SVG text: letters or shapes.** With "letters", the file holds real text and carries its fonts. The text can be searched and retyped, but a program that ignores an embedded font may swap in another one. With "shapes", the letters are written as outlines, so the file looks the same in programs that ignore an embedded font. The letters are then shapes: they cannot be searched, selected or retyped.
- **PNG size** is capped at 16,000,000 pixels. The dialog says when a smaller size will be used.
- **PDF** is vector, with real text and its fonts inside. On a fixed page the diagram is centered and never enlarged past its own size. The dialog says when it would be small on that page.
- **chalkboard** is the dark theme on its dark page color.

"download" saves `<id>.png`, `.svg` or `.pdf`. "copy" puts the picture (PNG) or the SVG text on the clipboard. Escape, "close" or a click outside closes the dialog. Your choices are remembered.

Nothing from the editor is in the file: no selection, no grid, no handles.

"download SVG" in write is a shortcut: the figure as it looks now, in the look and theme on screen.

## 11. Embedding

A diagram can sit in any web page as an iframe. The diagram's text travels in the link, so there is nothing to upload.

- **Any page:** in write, press "copy embed code" and paste the iframe into the page.
- **kyleschlaepfer.com:** press "copy for the site" for the import line and the `<DiagramEmbed>` line.

The embed shows the figure, "describe this figure" (a text alternative), step controls when the diagram has `step` lines, and a footer with "open in playground" and "download SVG".

Options go in the link's hash, after `v=1&d=...`:

| Option | Does |
|---|---|
| `step=2` or `step=all` | the first step shown |
| `theme=light` or `theme=dark` | fixes the theme. Left out, it follows the page or the system |
| `lint=1` | shows the notation check |
| `qa=1` | adds the layout check |
| `tools=0` | hides the footer |
| `look=precision` or `look=sketch` | draws in that look. Left out, the diagram's own `look` line decides |

The full protocol, with the messages a host page can send and receive, is in `spec/embed-protocol.md`.

## 12. Keyboard shortcuts

On a Mac, use Cmd where this says Ctrl.

### Anywhere

| Keys | Does |
|---|---|
| Left, Right, Home, End | move between the views when the views row has focus |
| Down, Up, Home, End | move in an open menu (new, open, save, tidy up) |
| Escape | closes a menu or the export dialog |

### Write

| Keys | Does |
|---|---|
| Ctrl+Z | undo |
| Ctrl+Y or Ctrl+Shift+Z | redo |
| Shift+Alt+F | tidy |
| Ctrl+/ | turn the line into a comment, or back |
| Ctrl+F | find and replace |
| Ctrl+Space | completions |

The editor is CodeMirror, and its other standard keys for moving, selecting and searching work too.

### Draw, with the canvas focused

| Keys | Does |
|---|---|
| Ctrl+Z | undo |
| Ctrl+Y or Ctrl+Shift+Z | redo |
| Ctrl+A | select every shape and line |
| Ctrl+C, Ctrl+X, Ctrl+V | copy, cut, paste |
| Ctrl+D | duplicate |
| Delete or Backspace | delete the selection |
| arrow keys | nudge the selection 0.05 in (one grid step with "snap to grid"). With nothing selected, select the first shape |
| Shift+arrow keys | nudge 0.25 in |
| Tab, Shift+Tab | with a shape selected, go to the next or previous shape |
| Enter or F2 | edit the selected shape's text or the selected line's label |
| Enter while a relationship tool is active | choose the selected source, then the selected target |
| Alt+A, Alt+O | add an attribute or operation to the selected class or interface, then edit it inline |
| any letter or digit | start replacing the selected shape's text or the selected line's label |
| Escape | cancel what you are doing, or clear the selection |
| Space, held | pan by dragging, even over a shape |
| Ctrl+arrow keys | pan the view; with Shift, a bigger step |
| Ctrl+0 | actual size |
| Ctrl+1 | fit the whole diagram |
| Ctrl+= or Ctrl++ | zoom in |
| Ctrl+- | zoom out |

### While editing text on the canvas

| Keys | Does |
|---|---|
| Enter | keep the change |
| Shift+Enter | new line, in a shape's text |
| Escape | give up the change |

### While placing or dragging

| Keys | Does |
|---|---|
| repeated click | keep placing the same armed shape until Escape or another tool |
| Shift+click on a shape | add it to the selection, or take it out |
| Alt, held | place, move or bend freely; resize from the center |

### A figure with steps

| Keys | Does |
|---|---|
| Left, Right | back one step, on one step, when the figure has focus |
