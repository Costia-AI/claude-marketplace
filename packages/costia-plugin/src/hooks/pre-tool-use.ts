import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { managedContents } from "../sync/agents-md.ts";
import { emit, readHookInput } from "./io.ts";

interface Input {
  tool_name: string;
  tool_input: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
    edits?: { old_string: string; new_string: string; replace_all?: boolean }[];
  };
}

function applyEdit(text: string, oldString: string, newString: string, all = false): string {
  return all ? text.split(oldString).join(newString) : text.replace(oldString, () => newString);
}

/** The file as it would be after the tool call, or null when it cannot be predicted. */
function predicted(current: string, input: Input): string | null {
  const t = input.tool_input;
  if (input.tool_name === "Write") return t.content ?? null;
  if (input.tool_name === "Edit" && t.old_string !== undefined && t.new_string !== undefined) {
    return applyEdit(current, t.old_string, t.new_string, t.replace_all);
  }
  if (input.tool_name === "MultiEdit" && t.edits) {
    return t.edits.reduce((text, e) => applyEdit(text, e.old_string, e.new_string, e.replace_all), current);
  }
  return null;
}

/**
 * Stops Claude from editing managed AGENTS.md sections by hand. Anything else in
 * the file — including every unmanaged section — stays editable. Silent and
 * fast for every other file.
 */
export async function preToolUse(): Promise<void> {
  const input = (await readHookInput<Input>()) as Input;
  const path = input.tool_input?.file_path;
  if (!path) return;
  if (/^costia--[\w.-]+\.md$/.test(basename(path)) && basename(dirname(path)) === "rules") {
    // A private or user section: the whole file is managed.
    emit({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `${basename(path)} is a Costia-managed section, written whole by the costia plugin. ` +
          "Change it for everyone who uses it with the costia MCP tool `edit_section`, or remove it from your setup (set_selection / the web). Rules of your own belong in another file.",
      },
    });
    return;
  }
  if (basename(path) !== "AGENTS.md") return;

  let current: string;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    return;
  }
  if (!current.includes("costia:begin")) return;

  const before = managedContents(current);
  if (!before || before.size === 0) return;
  const next = predicted(current, input);
  const after = next === null ? null : managedContents(next);

  const touched = after === null ? [...before.keys()] : [...before.keys()].filter((id) => after.get(id) !== before.get(id));
  const smuggled = after ? [...after.keys()].filter((id) => !before.has(id)) : [];
  if (!touched.length && !smuggled.length) return;

  const names = [...touched, ...smuggled].join(", ");
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `The Costia-managed AGENTS.md section(s) ${names} cannot be edited in place: they are shared with every repository that uses them. ` +
        "Use the costia MCP tool `edit_section` to change a section for all repositories, or `detach_section` to make it this repository's own. " +
        "Rules for this repository only belong outside the costia:begin/costia:end blocks.",
    },
  });
}
