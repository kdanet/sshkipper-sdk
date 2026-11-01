// __TITLE__: a model provider of SSHKipper SDK 1 (spec/protocol.md §13). The app sends the chat it would send any
// provider — already masked and under the AI mode's policy — and draws the answer as it streams. A tool call your
// model makes goes through the app's rules and the user's confirmations: the program never runs a tool itself. This
// start echoes the last question word by word; call your API with `req.settings.endpoint` and `req.secrets.api_key`
// (add the «network» permission when it does).

import { defineModule, type AIChatRequest } from "./lib/sshkipper-sdk/index.ts";

const lastQuestion = (req: AIChatRequest) => {
  const user = [...req.messages].reverse().find((m) => m.role === "user");
  return user?.content.map((b) => (b.type === "text" ? b.text : "")).join(" ").trim() || "…";
};

defineModule({
  handlers: {},
  ai: {
    models: () => [{ id: "echo-1", title: "Echo 1" }],
    async chat(req, ctx) {
      const words = `You asked: ${lastQuestion(req)}`.split(" ");
      for (const [i, w] of words.entries()) {
        if (ctx.signal.aborted) return { stop: "end_turn" };
        ctx.delta({ type: "text", text: (i ? " " : "") + w });
        await new Promise((r) => setTimeout(r, 20));
      }
      ctx.delta({ type: "usage", input: JSON.stringify(req.messages).length >> 2, output: words.length });
      return { stop: "end_turn", model: req.model };
    },
  },
});
