import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { get, send } from "../../api/client.ts";
import { config } from "../../config.ts";
import { checkoutFor } from "../../state/checkouts.ts";
import { guarded, workdir } from "../server.ts";

interface Step {
  id: string;
  position: number;
  text: string;
  done: boolean;
}

interface Task {
  id: string;
  ref: string;
  title: string;
  body?: string;
  manual: boolean;
  priority?: "low" | "normal" | "high" | "urgent";
  state: "open" | "in_progress" | "done";
  assignee?: string;
  steps: Step[];
}

function projectOf(project?: string): string {
  if (project) return project;
  const found = checkoutFor(workdir());
  if (!found) throw new Error("No project given and this folder is not linked to one.");
  return found.checkout.projectId;
}

function render(task: Task): string {
  const done = task.steps.filter((s) => s.done).length;
  return [
    `${task.ref} ${task.title}${task.manual ? " [manual]" : ""} — ${task.state}${task.priority && task.priority !== "normal" ? `, ${task.priority}` : ""}${task.assignee ? `, ${task.assignee}` : ""} (${done}/${task.steps.length})`,
    ...task.steps.map((s) => `  ${s.done ? "[x]" : "[ ]"} ${s.position}. ${s.text}`),
  ].join("\n");
}

const stepsInput = z.array(z.string().min(1).max(2000)).max(50);

export function registerTools(server: McpServer, _: unknown): void {
  server.registerTool(
    "list_tasks",
    {
      description: "Tasks of a project (the current one by default). manual=true lists only what the user must do by hand.",
      inputSchema: z.object({ project: z.string().optional(), state: z.enum(["open", "done", "all"]).default("open"), manual: z.boolean().optional() }),
    },
    guarded(async ({ project, state, manual }) => {
      const params = new URLSearchParams({ state });
      if (manual !== undefined) params.set("manual", String(manual));
      const id = projectOf(project);
      const { tasks } = await get<{ tasks: Task[] }>(`/v1/projects/${encodeURIComponent(id)}/tasks?${params}`);
      return tasks.length ? `${tasks.map(render).join("\n")}\nBoard: ${config.web}/p/${id}/tasks` : "No tasks.";
    }),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Records a task. manual=true for what only the user can do (a console form, a secret to seed, a store review…): write it in the user's language, with the exact steps and values.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(20_000).optional(),
        steps: stepsInput.default([]),
        manual: z.boolean().default(false),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        project: z.string().optional(),
      }),
    },
    guarded(async ({ project, ...task }) => render(await send<Task>("POST", `/v1/projects/${encodeURIComponent(projectOf(project))}/tasks`, task))),
  );

  server.registerTool(
    "update_task",
    {
      description: "Changes a task's title, body, priority, assignee or manual flag.",
      inputSchema: z.object({
        task: z.string(),
        title: z.string().max(200).optional(),
        body: z.string().max(20_000).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        manual: z.boolean().optional(),
        assignee: z.string().nullable().optional(),
      }),
    },
    guarded(async ({ task, ...patch }) => render(await send<Task>("PATCH", `/v1/tasks/${encodeURIComponent(task)}`, patch))),
  );

  server.registerTool(
    "add_steps",
    { description: "Appends steps to a task.", inputSchema: z.object({ task: z.string(), steps: stepsInput.min(1) }) },
    guarded(async ({ task, steps }) => render(await send<Task>("POST", `/v1/tasks/${encodeURIComponent(task)}/steps`, { steps }))),
  );

  server.registerTool(
    "complete_steps",
    {
      description: "Marks steps done (by position). A task is done when all its steps are.",
      inputSchema: z.object({ task: z.string(), positions: z.array(z.number().int().min(1)).min(1) }),
    },
    guarded(async ({ task, positions }) => render(await send<Task>("POST", `/v1/tasks/${encodeURIComponent(task)}/steps:complete`, { positions }))),
  );

  server.registerTool(
    "complete_task",
    { description: "Marks a task and all its steps done.", inputSchema: z.object({ task: z.string() }) },
    guarded(async ({ task }) => render(await send<Task>("POST", `/v1/tasks/${encodeURIComponent(task)}/done`, {}))),
  );
}
