/** Starting points for "new": the smallest valid diagram of each kind, ready to grow in either view. */
export interface Template { key: string; label: string; hint: string; text: string }

export const TEMPLATES: Template[] = [
  {
    key: "flowchart", label: "flowchart", hint: "steps and decisions",
    text: "diagram flowchart\ntitle What this flow shows\n\nstart begin\nprocess step1 \"first step\"\nend done\n\nbegin -> step1\nstep1 -> done\n",
  },
  {
    key: "activity", label: "activity diagram", hint: "UML actions, forks and joins",
    text: "diagram activity\ntitle What this activity shows\n\nstart begin\naction action1 \"first action\"\nend done\n\nbegin -> action1\naction1 -> done\n",
  },
  {
    key: "lanes", label: "activity with swimlanes", hint: "who does what, in three partitions",
    text: [
      "diagram activity", "title Who does what, in order", "",
      'partition lane1 "First role" {', "  start begin", '  action action1 "first action"', "}",
      'partition lane2 "Second role" {', '  action action2 "second action"', "}",
      'partition lane3 "Third role" {', '  action action3 "third action"', "  end done", "}", "",
      "begin -> action1", "action1 -> action2", "action2 -> action3", "action3 -> done", "",
    ].join("\n"),
  },
  {
    key: "use-case", label: "use-case diagram", hint: "actors and what they use the system for",
    text: 'diagram use-case\ntitle Who uses the system for what\n\nactor actor1 "Actor"\nboundary system "System" {\n  use-case usecase1 "do something"\n}\n\nactor1 -- usecase1\n',
  },
  {
    key: "class", label: "class diagram", hint: "classes, members and relationships",
    text: [
      "diagram class", "title How these classes relate", "",
      "class Thing {", "  +name: String", "  +describe(): String", "}",
      "class SpecialThing {", "  +extra: int", "}", "",
      "SpecialThing --|> Thing", "",
    ].join("\n"),
  },
];
