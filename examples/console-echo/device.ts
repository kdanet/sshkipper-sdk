// A pretend serial device: what sits at the other end of a serial console — it echoes what it gets (a serial line
// has no local echo), edits its line itself, and answers a few commands. Nothing here runs a shell, opens a port or
// touches the network: a real console extension would relay bytes to a provider's gateway (an SSH serial gateway, a
// WebSocket, `ipmitool sol`) in place of this class. Kept apart from module.ts so tests can drive it without a program.

const ESC = "\u001b";
const dim = (s: string) => `${ESC}[2m${s}${ESC}[0m`;
const ok = `${ESC}[32m  OK  ${ESC}[0m`;

export interface DeviceIO {
  write(text: string): void;
  close(reason?: string): void;
  size(): { cols: number; rows: number };
}

export class Device {
  private line = "";
  /** Inside an escape sequence the terminal sent (arrows, function keys): skipped, not echoed. */
  private escape = false;
  private decoder = new TextDecoder();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;

  private io: DeviceIO;
  private name: string;
  private ru: boolean;

  // Plain fields, not parameter properties: Node runs this file by stripping types only.
  constructor(io: DeviceIO, name: string, ru: boolean) {
    this.io = io;
    this.name = name;
    this.ru = ru;
  }

  private say(ru: string, en: string) { return this.ru ? ru : en; }
  private get prompt() { return `${ESC}[1;36m${this.name}${ESC}[0m:${ESC}[1;34m~${ESC}[0m# `; }

  /** The boot log, line by line (a device that just got power), then the prompt. */
  boot(fast = false) {
    const lines = [
      dim("U-Boot 2024.01 (pretend)"),
      `[${ok}] ${this.say("Тактирование", "Clocks")}`,
      `[${ok}] ${this.say("Память: 512 МБ", "Memory: 512 MB")}`,
      `[${ESC}[33mWARN${ESC}[0m] ${this.say("Часы не заданы — время с 1970 года", "No RTC time — counting from 1970")}`,
      `[${ok}] ${this.say("Консоль ttyS0, 115200 8N1", "Console ttyS0, 115200 8N1")}`,
      "",
      this.say(`Добро пожаловать на ${this.name} (учебное устройство). help — команды.`, `Welcome to ${this.name} (a pretend device). help — commands.`),
    ];
    let t = 0;
    for (const l of lines) this.later((t += fast ? 0 : 60), () => this.io.write(l + "\r\n"));
    this.later(t + (fast ? 0 : 60), () => this.io.write(this.prompt));
  }

  private later(ms: number, f: () => void) {
    const id = setTimeout(() => { this.timers.delete(id); if (!this.closed) f(); }, ms);
    this.timers.add(id);
  }

  stop() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Bytes from the terminal: echoed and edited like a device's line discipline. */
  input(bytes: Uint8Array) {
    const text = this.decoder.decode(bytes, { stream: true });
    let echo = "";
    for (const ch of text) {
      if (this.escape) { if (/[A-Za-z~]/.test(ch)) this.escape = false; continue; }
      if (ch === ESC) { this.escape = true; continue; }
      if (ch === "\r" || ch === "\n") {
        this.io.write(echo + "\r\n");
        echo = "";
        const cmd = this.line.trim();
        this.line = "";
        if (this.run(cmd)) return;
        this.io.write(this.prompt);
      } else if (ch === "\u007f" || ch === "\b") {
        if (this.line.length) { this.line = [...this.line].slice(0, -1).join(""); echo += "\b \b"; }
      } else if (ch === "\u0003") {
        this.line = "";
        this.io.write(echo + "^C\r\n" + this.prompt);
        echo = "";
      } else if (ch === "\u0004") {
        if (!this.line) { this.io.write(echo + "logout\r\n"); this.io.close(this.say("выход по Ctrl-D", "Ctrl-D")); return; }
      } else if (ch >= " " || ch === "\t") {
        this.line += ch;
        echo += ch;
      }
    }
    if (echo) this.io.write(echo);
  }

  /** A command; true — no prompt after it (the console closed, or a boot prints its own). */
  private run(cmd: string): boolean {
    const [word, arg] = cmd.split(/\s+/, 2);
    const out = (s: string) => this.io.write(s.replaceAll("\n", "\r\n") + "\r\n");
    switch (word) {
      case "": return false;
      case "help":
        out(this.say(
          "help     — эта справка\nuname    — что за устройство\nsize     — размер терминала\ncolors   — цвета терминала\nboot     — загрузка заново\nflood N  — N КБ вывода сразу (проверка лимита)\nclear    — очистить экран\nexit     — закрыть консоль (или Ctrl-D)",
          "help     — this help\nuname    — what device this is\nsize     — the terminal's size\ncolors   — the terminal's colours\nboot     — boot again\nflood N  — N KB of output at once (the limit)\nclear    — clear the screen\nexit     — close the console (or Ctrl-D)"));
        return false;
      case "uname": out(`PretendOS 1.0 ${this.name} armv7l (${this.say("учебная серийная консоль", "a pretend serial console")})`); return false;
      case "size": { const s = this.io.size(); out(`${s.cols}x${s.rows}`); return false; }
      case "colors": {
        let basic = "";
        for (let i = 0; i < 8; i++) basic += `${ESC}[4${i}m  ${ESC}[0m`;
        let bright = "";
        for (let i = 0; i < 8; i++) bright += `${ESC}[10${i}m  ${ESC}[0m`;
        let ramp = "";
        for (let i = 0; i < 48; i++) ramp += `${ESC}[48;2;${Math.round(255 * i / 47)};${Math.round(128 - 128 * i / 47)};${255 - Math.round(255 * i / 47)}m ${ESC}[0m`;
        out(`${basic}\n${bright}\n${ramp}\n${ESC}[1m${this.say("жирный", "bold")}${ESC}[0m ${ESC}[3m${this.say("курсив", "italic")}${ESC}[0m ${ESC}[4m${this.say("подчёркнутый", "underlined")}${ESC}[0m ${ESC}[31m${this.say("красный", "red")}${ESC}[0m ${ESC}[32m${this.say("зелёный", "green")}${ESC}[0m`);
        return false;
      }
      case "boot": this.io.write(`${ESC}[2J${ESC}[H`); this.boot(); return true;
      case "clear": this.io.write(`${ESC}[2J${ESC}[H`); return false;
      case "flood": {
        const kb = Math.max(1, Math.min(65536, Number(arg) || 1024));
        const row = "0123456789abcdefghijklmnopqrstuvwxyz".repeat(2).slice(0, 63) + "\r\n";
        this.io.write(row.repeat(Math.ceil(kb * 1024 / row.length)));
        out(this.say(`— отправлено ${kb} КБ`, `— ${kb} KB sent`));
        return false;
      }
      case "exit": case "logout": this.io.close(this.say("выход по команде exit", "exit")); return true;
      default: out(this.say(`${word}: нет такой команды (help — список)`, `${word}: no such command (help — the list)`)); return false;
    }
  }
}
