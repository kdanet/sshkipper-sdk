// «Эхо» — an example model provider of SDK 1 (spec/protocol.md §12): a program on this Mac that answers `ai/models`
// and `ai/chat` like a model would — deterministically, with no network and no real model. It streams its answer in
// pieces (`ctx.delta`), stops when the app sends `ai/cancel`, and asks for tools: «проверь сервер» / "check the server"
// → list_sessions → run_command uptime on the first session → a short report.

import { defineModule, type AIBlock, type AIChatRequest, type AIChatResult, type AIMessage, type Json } from "./lib/sshkipper-sdk/index.ts";

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new Error("cancelled"));
  const t = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("cancelled")); }, { once: true });
});

type TextBlock = Extract<AIBlock, { type: "text" }>;
type ToolUse = Extract<AIBlock, { type: "tool_use" }>;
type ToolResult = Extract<AIBlock, { type: "tool_result" }>;

const textOf = (m?: AIMessage) => (m?.content ?? []).filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("");
/** The user's last words (not a message that only carries tool results). */
const lastUserText = (req: AIChatRequest) => textOf([...req.messages].reverse().find((m) => m.role === "user" && m.content.some((b) => b.type === "text")));
/** The tool results of the last message (the app sends them as one user message after a tool turn). */
const results = (req: AIChatRequest) => (req.messages.at(-1)?.content ?? []).filter((b): b is ToolResult => b.type === "tool_result");
/** The tools this conversation already called, by name — since the user's last words. */
function called(req: AIChatRequest): string[] {
  const start = req.messages.findLastIndex((m) => m.role === "user" && m.content.some((b) => b.type === "text"));
  return req.messages.slice(start + 1).flatMap((m) => m.content).filter((b): b is ToolUse => b.type === "tool_use").map((b) => b.name);
}

const wantsTools = (text: string) => /провер|check|uptime|метк|mark/i.test(text);
/** «Поставь метку» / "leave a mark": a command that changes something (an empty file in /tmp) — the app asks first. */
const wantsChange = (text: string) => /метк|mark/i.test(text);
const hasTool = (req: AIChatRequest, name: string) => req.tools.some((t) => t.name === name);

defineModule({
  handlers: {},
  ai: {
    models: () => [
      { id: "echo-1", title: "Echo 1" },
      { id: "echo-1-slow", title: "Echo 1 (slow)" },
    ],

    async chat(req, ctx): Promise<AIChatResult> {
      const delay = Math.max(0, Math.min(2000, Number(req.settings.delay_ms ?? 30))) * (req.model.endsWith("-slow") ? 10 : 1);
      const greeting = String(req.settings.greeting ?? "") || "Эхо";
      const say = async (text: string) => {
        // Word by word, as a model streams.
        for (const piece of text.match(/\S+\s*/g) ?? []) {
          ctx.delta({ type: "text", text: piece });
          await sleep(delay, ctx.signal);
        }
      };
      const usage = { input_tokens: JSON.stringify(req.messages).length >> 2, output_tokens: 0 };
      const toolTurn = (id: string, name: string, input: Record<string, Json>): AIChatResult => {
        ctx.delta({ type: "tool_use", toolId: id, name });
        ctx.delta({ type: "tool_input", toolId: id, json: JSON.stringify(input) });
        return { stop: "tool_use", usage: { ...usage, output_tokens: 20 }, model: req.model };
      };

      const done = called(req);
      const got = results(req);
      // Asked to check a server: first the sessions, then uptime on the first one, then the report.
      if (wantsTools(lastUserText(req)) && hasTool(req, "list_sessions") && hasTool(req, "run_command")) {
        if (!done.includes("list_sessions")) {
          await say(`${greeting}: посмотрю, какие сессии открыты. `);
          return toolTurn("echo-ls", "list_sessions", {});
        }
        if (!done.includes("run_command")) {
          const first = got[0]?.content.split("\n")[0]?.match(/^([^:\s]+):/)?.[1];
          if (!first || got[0]?.is_error) {
            await say(`${greeting}: открытых сессий нет — откройте вкладку сервера и спросите снова.`);
            return { stop: "end_turn", usage, model: req.model };
          }
          const change = wantsChange(lastUserText(req));
          const command = change ? "touch /tmp/sshkipper-echo-mark" : "uptime";
          await say(`${greeting}: выполню ${command} в сессии ${first}. `);
          return toolTurn("echo-run", "run_command", change
            ? { session_id: first, command, timeout_s: 20, purpose: "Оставить пустой файл-метку в /tmp", effects: ["write"] }
            : { session_id: first, command, timeout_s: 20, purpose: "Посмотреть, сколько сервер работает и его нагрузку", effects: ["read"] });
        }
        const out = got[0]?.content ?? "";
        const line = out.split("\n").find((l) => /load average|up /i.test(l)) ?? out.split("\n")[0] ?? "";
        const said = got[0]?.is_error ? `${greeting}: команда не выполнилась — ${line}`
          : wantsChange(lastUserText(req)) ? `${greeting}: метка /tmp/sshkipper-echo-mark на месте.` : `${greeting}: сервер ответил. ${line.trim()}`;
        await say(said);
        return { stop: "end_turn", usage: { ...usage, output_tokens: 30 }, model: req.model };
      }

      // The app puts what it knows of the moment (the date, the sessions) before the question: not echoed back.
      const question = lastUserText(req).replace(/<sshkipper_context>[\s\S]*?<\/sshkipper_context>/g, "").trim();
      const key = typeof req.secrets.api_key === "string" ? req.secrets.api_key : "";
      await say([
        `${greeting}: вы написали «${question.slice(0, 200)}».`,
        `Модель ${req.model}${req.effort ? `, рассуждение ${req.effort}` : ""}; сообщений ${req.messages.length}, инструментов ${req.tools.length}.`,
        key ? `Ключ получен (${key.length} знаков).` : "Ключ не задан.",
      ].join(" "));
      return { stop: "end_turn", usage: { ...usage, output_tokens: 40 }, model: req.model };
    },
  },
});
