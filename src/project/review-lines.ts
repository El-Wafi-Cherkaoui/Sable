import path from "node:path";
import type { ProjectBaseItem } from "../config/config-types.js";
import type { ReviewLine } from "../tui/review-view.js";
import type { PlaceholderInfo, ProjectChanges, ResolvedProjectItem } from "./project-sync.js";

// What a project item would do, as short labelled facts. Empty or default facts are left out.
function facts(base: ProjectBaseItem, projectDirectory: string, includeDefaults = false): Array<[string, string]> {
  const folder = path.relative(projectDirectory, base.cwd) || ".";
  const env = Object.entries(base.env).map(([key, value]) => `${key}=${value}`).join(" ");
  const all: Array<[string, string]> = [
    ["run", base.command],
    ["in", folder],
    ["env", env],
    ["secret", base.secrets.length === 0 ? "" : `${base.secrets.join(", ")}  (you are asked for ${base.secrets.length === 1 ? "it" : "them"} when it first runs)`],
    ["after", base.after.join(", ")],
    ["starts", base.kind === "service" ? (base.autoStart === false ? "only when you start it" : "when the workspace opens") : ""],
  ];

  return all.filter(([label, value]) => includeDefaults || (value !== "" && !(label === "in" && value === ".")));
}

function describe(item: ResolvedProjectItem, projectDirectory: string, tone: ReviewLine["tone"], mark: string): ReviewLine[] {
  const { name, ...base } = item;

  return [
    { text: `${mark} ${base.kind} ${name}`, tone: tone === "plain" ? "heading" : tone },
    ...facts(base, projectDirectory).map(([label, value]): ReviewLine => ({ text: `    ${label.padEnd(6)} ${value}` })),
  ];
}

export function importReviewLines(
  items: ResolvedProjectItem[],
  placeholders: PlaceholderInfo[],
  projectDirectory: string,
): ReviewLine[] {
  const lines: ReviewLine[] = items.flatMap((item) => [...describe(item, projectDirectory, "plain", "•"), { text: "" }]);

  if (placeholders.length > 0) {
    lines.push({ text: "Sable will ask you for:", tone: "heading" });

    for (const placeholder of placeholders) {
      const extra = [placeholder.description, placeholder.default === undefined ? undefined : `default ${placeholder.default}`].filter((part) => part !== undefined);

      lines.push({ text: `    {{${placeholder.name}}}${extra.length === 0 ? "" : `  ${extra.join(", ")}`}` });
    }
  }

  return lines;
}

export function changesReviewLines(changes: ProjectChanges, projectDirectory: string): ReviewLine[] {
  const lines: ReviewLine[] = [];

  for (const item of changes.added) {
    lines.push(...describe(item, projectDirectory, "added", "+ new"), { text: "" });
  }

  for (const { item, before } of changes.changed) {
    const { name, ...after } = item;
    const was = new Map(facts(before, projectDirectory, true));
    const now = new Map(facts(after, projectDirectory, true));

    lines.push({ text: `~ changed ${after.kind} ${name}`, tone: "heading" });

    if (before.kind !== after.kind) {
      lines.push({ text: `    - was a ${before.kind}`, tone: "removed" }, { text: `    + is now a ${after.kind}`, tone: "added" });
    }

    for (const [label, value] of now) {
      const old = was.get(label);

      if (old !== value) {
        if (old !== undefined && old !== "") {
          lines.push({ text: `    - ${label.padEnd(6)} ${old}`, tone: "removed" });
        }

        if (value !== "") {
          lines.push({ text: `    + ${label.padEnd(6)} ${value}`, tone: "added" });
        }
      }
    }

    lines.push({ text: "" });
  }

  for (const name of changes.removed) {
    lines.push({ text: `- removed ${name}`, tone: "removed" }, { text: "" });
  }

  return lines;
}
