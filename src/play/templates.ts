/** Blank, valid starting points for the type-first New diagram picker. */
export interface Template { key: string; label: string; hint: string; text: string }

export const TEMPLATES: Template[] = [
  {
    key: "flowchart", label: "flowchart", hint: "steps and decisions",
    text: "diagram flowchart\ntitle Untitled flowchart\n",
  },
  {
    key: "activity", label: "activity diagram", hint: "UML actions, decisions, forks and swimlanes",
    text: "diagram activity\ntitle Untitled activity diagram\n",
  },
  {
    key: "use-case", label: "use-case diagram", hint: "actors and what they use the system for",
    text: "diagram use-case\ntitle Untitled use-case diagram\n",
  },
  {
    key: "class", label: "class diagram", hint: "classes, members and relationships",
    text: "diagram class\ntitle Untitled class diagram\n",
  },
];
