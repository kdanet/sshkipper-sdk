// A page or a screen of an extension folder, built and lived through without the app: the render (or template), then
// events sent the way the app sends them (spec/protocol.md §11.3), their ops and the program's pushes applied
// (§11.4–11.5). For `sshkipper-ext preview` and the MCP tool `screen_preview`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { call, request, startProgram, type CallOptions } from "./dev.ts";
import { applyOps, preview, type OpProblem } from "./preview.ts";
import { expand } from "./template.ts";
import type { Json, Manifest } from "./types.ts";
import { manifestFile, validateView } from "./validate.ts";

/** An event to send: what the user does on the screen. `seq`, `screen` and `state` are filled in. */
export interface PreviewEvent { type: string; block?: string; value?: Json }

export interface ScreenPreviewOptions extends CallOptions {
  /** Template data of a page with `view` (`data.*`); with `run` its data handlers are called instead. */
  data?: Record<string, Json>;
  run?: boolean;
  /** Sent in order after the render; each answer's ops are applied. */
  events?: PreviewEvent[];
  /** Milliseconds to wait after the last event for the program's own pushes (`ui/push`). */
  wait?: number;
}

export interface ScreenPreview {
  /** The outline of the screen as text, after everything. */
  text: string;
  view: Json;
  /** What a view check finds, as the app would. */
  issues: string[];
  /** Ops the screen couldn't apply. */
  problems: OpProblem[];
  /** What each event got back, in short. */
  answers: string[];
  log: string[];
}

/** What can be previewed in a folder: pages (`pages[].id`) and screens (`contributes.screen[].id`). */
export function previewTargets(m: Manifest): { pages: string[]; screens: string[] } {
  return { pages: (m.pages ?? []).map((p) => p.id), screens: (m.contributes?.screen ?? []).map((s) => s.id) };
}

/** Builds page or screen `id` of the extension in `dir` and sends it `events`. A process program stays running from
 * the render to the last event, as the app keeps it. */
export async function previewScreen(dir: string, id: string | undefined, o: ScreenPreviewOptions = {}): Promise<ScreenPreview> {
  const m: Manifest = JSON.parse(readFileSync(join(dir, manifestFile(dir)), "utf8"));
  const page = (m.pages ?? []).find((p) => p.id === (id ?? m.service?.page ?? m.pages?.[0]?.id));
  const screen = page ? undefined : (m.contributes?.screen ?? []).find((s) => s.id === (id ?? m.contributes?.screen?.[0]?.id));
  if (!page && !screen) {
    const t = previewTargets(m);
    throw new Error(`no page or screen «${id ?? ""}» — pages: ${t.pages.join(", ") || "none"}; screens: ${t.screens.join(", ") || "none"}`);
  }
  const log: string[] = [];
  const answers: string[] = [];
  const problems: OpProblem[] = [];
  const vars: Record<string, Json> = { settings: o.settings ?? {}, item: o.item ?? null, server: o.ssh ? { name: o.ssh } : null };
  const program = m.runtime.kind === "process" ? startProgram(dir, m, o) : null;
  const handler = async (name: string, input: Record<string, Json>) => {
    if (!program) {
      const r = await call(dir, name, { ...o, input });
      log.push(...r.log);
      if (!r.ok) throw new Error(`${name}: ${r.error}`);
      return r.value ?? null;
    }
    const r = await program.request("handler/call", request(m, name, { ...o, input }) as unknown as Json, m.handlers?.[name]?.timeout ?? 30);
    if (!r.ok) throw new Error(`${name}: ${r.error}`);
    return r.value ?? null;
  };
  try {
    let view: Json;
    const renderer = page?.render ?? screen?.render;
    if (renderer) {
      view = await handler(renderer, screen ? { screen: screen.id, node: (o.node ?? null) as Json } : (o.input ?? {}));
    } else {
      view = JSON.parse(readFileSync(join(dir, page!.view!), "utf8"));
      const data: Record<string, Json> = { ...(o.data ?? {}) };
      if (o.run) for (const [k, h] of Object.entries(page!.data ?? {})) data[k] = await handler(h, {});
      vars.data = data;
    }
    const issues = validateView(view, { components: (m.components ?? {}) as Record<string, Json>, vars }).map((i) => `${i.severity === "error" ? "✗" : "⚠"} ${i.path}: ${i.message}`);
    // The app expands a template before drawing; a rendered view carries no placeholders of its own data.
    let live: any = renderer ? view : expand(view, vars, (m.components ?? {}) as Record<string, Json>);
    const screenID = `${m.id}/${screen?.id ?? page!.id}`;
    const events = live?.events;
    let seq = 0;
    let seenPushes = 0;
    const applyPushes = () => {
      if (!program) return;
      for (const n of program.notices.slice(seenPushes)) {
        if (n.method !== "ui/push") continue;
        const p = n.params as any;
        if (p?.screen !== screenID) { log.push(`ui/push to another screen «${p?.screen}» — dropped`); continue; }
        const r = applyOps(live, p.ops ?? []);
        live = r.view;
        problems.push(...r.problems);
        answers.push(`push: ${(p.ops ?? []).length} op(s)`);
      }
      seenPushes = program.notices.length;
    };
    for (const e of o.events ?? []) {
      if (!events) { answers.push(`${e.type}: not sent — the view has no «events» (not a live screen)`); continue; }
      const event = { screen: screenID, seq: ++seq, type: e.type, ...(e.block ? { block: e.block } : {}), ...(e.value !== undefined ? { value: e.value } : {}), state: live.state ?? {} };
      let answer: Json;
      if (events === true) {
        if (!program) { answers.push(`${e.type}: a server module answers events by a handler — set «events» to its name`); continue; }
        const context = request(m, "", o).context;
        const r = await program.request("ui/event", { event, context } as unknown as Json, 30);
        if (!r.ok) { answers.push(`${e.type}: error — ${r.error}`); continue; }
        answer = r.value ?? null;
      } else {
        answer = await handler(String(events), { event: event as unknown as Json });
      }
      const ops = Array.isArray(answer) ? answer : ((answer as any)?.ops ?? []);
      const items = Array.isArray(answer) ? undefined : (answer as any)?.items;
      answers.push(`${e.type}: ${ops.length} op(s)${items ? `, ${items.length} completion(s): ${items.slice(0, 8).map((x: any) => (typeof x === "string" ? x : x.title)).join(", ")}` : ""}`);
      const r = applyOps(live, ops);
      live = r.view;
      problems.push(...r.problems);
      applyPushes();
    }
    if (o.wait && program) {
      await new Promise((r) => setTimeout(r, o.wait));
      applyPushes();
    }
    return { text: preview(live, {}, {}), view: live, issues, problems, answers, log: program ? program.log : log };
  } finally {
    if (program) await program.close();
  }
}
