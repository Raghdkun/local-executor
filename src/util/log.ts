import * as p from "@clack/prompts";
import pc from "picocolors";

/**
 * Thin layer over @clack/prompts so every step renders the same way and so
 * `--json` / non-TTY runs can silence the UI and answer prompts with defaults.
 */

export interface UiMode {
  /** Answer every prompt with its default; never block. */
  yes: boolean;
  /** Emit nothing but the final JSON document on stdout. */
  json: boolean;
  /** stdout is not a terminal; behave like --yes and print plain lines. */
  tty: boolean;
}

export const ui: UiMode = { yes: false, json: false, tty: Boolean(process.stdout.isTTY) };

export function configureUi(opts: Partial<UiMode>): void {
  Object.assign(ui, opts);
}

/** True when we must not block on a prompt. */
export function nonInteractive(): boolean {
  return ui.yes || ui.json || !ui.tty;
}

function silent(): boolean {
  return ui.json;
}

export function intro(title: string): void {
  if (silent()) return;
  p.intro(pc.bgCyan(pc.black(` ${title} `)));
}

export function outro(message: string): void {
  if (silent()) return;
  p.outro(message);
}

export function header(step: string, title: string, oneLiner: string): void {
  if (silent()) return;
  p.log.step(`${pc.bold(pc.cyan(step))} ${pc.bold(title)}\n${pc.dim(oneLiner)}`);
}

export function info(msg: string): void {
  if (silent()) return;
  p.log.info(msg);
}
export function success(msg: string): void {
  if (silent()) return;
  p.log.success(msg);
}
export function warn(msg: string): void {
  if (silent()) return;
  p.log.warn(pc.yellow(msg));
}
export function error(msg: string): void {
  if (silent()) {
    process.stderr.write(`${msg}\n`);
    return;
  }
  p.log.error(pc.red(msg));
}
export function message(msg: string): void {
  if (silent()) return;
  p.log.message(msg);
}

export function note(body: string, title?: string): void {
  if (silent()) return;
  p.note(body, title);
}

export function box(body: string, title: string): void {
  if (silent()) return;
  p.box(body, title, { rounded: true });
}

/** Two-column key/value table rendered as aligned text. */
export function formatTable(rows: [string, string][]): string {
  const width = Math.max(0, ...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${pc.dim(k.padEnd(width))}  ${v}`).join("\n");
}

export function table(rows: [string, string][]): void {
  if (silent()) return;
  p.log.message(formatTable(rows));
}

export function code(text: string): string {
  return pc.cyan(text);
}

function cancelled(): never {
  if (!silent()) p.cancel("Cancelled.");
  process.exit(130);
}

export async function confirm(message: string, initial = true): Promise<boolean> {
  if (nonInteractive()) return initial;
  const v = await p.confirm({ message, initialValue: initial });
  if (p.isCancel(v)) cancelled();
  return v;
}

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

export async function select<T>(message: string, options: Choice<T>[], initial: T): Promise<T> {
  if (nonInteractive()) return initial;
  const v = await p.select<T>({
    message,
    options: options.map((o) =>
      o.hint === undefined ? { value: o.value, label: o.label } : o,
    ) as p.Option<T>[],
    initialValue: initial,
    maxItems: 12,
  });
  if (p.isCancel(v)) cancelled();
  return v as T;
}

export async function multiselect<T>(
  message: string,
  options: Choice<T>[],
  initial: T[],
  required = false,
): Promise<T[]> {
  if (nonInteractive()) return initial;
  const v = await p.multiselect<T>({
    message,
    options: options.map((o) =>
      o.hint === undefined ? { value: o.value, label: o.label } : o,
    ) as p.Option<T>[],
    initialValues: initial,
    required,
  });
  if (p.isCancel(v)) cancelled();
  return v as T[];
}

export async function text(
  message: string,
  placeholder: string,
  fallback: string,
): Promise<string> {
  if (nonInteractive()) return fallback;
  const v = await p.text({ message, placeholder, defaultValue: fallback });
  if (p.isCancel(v)) cancelled();
  return v || fallback;
}

export interface Spinner {
  start(msg: string): void;
  message(msg: string): void;
  stop(msg: string): void;
  error(msg: string): void;
}

const PLAIN_PROGRESS_INTERVAL_MS = 10_000;

const noopSpinner: Spinner = {
  start: () => undefined,
  message: () => undefined,
  stop: () => undefined,
  error: () => undefined,
};

export function spinner(): Spinner {
  if (silent()) return noopSpinner;
  if (!ui.tty) {
    // Plain-line fallback for logs/CI: no animation, and progress updates are
    // throttled so a long pull prints a line every few seconds, not per percent.
    let lastPrinted = 0;
    return {
      start: (m) => process.stdout.write(`${m}\n`),
      message: (m) => {
        const now = Date.now();
        if (now - lastPrinted >= PLAIN_PROGRESS_INTERVAL_MS) {
          lastPrinted = now;
          process.stdout.write(`  ${m}\n`);
        }
      },
      stop: (m) => process.stdout.write(`${m}\n`),
      error: (m) => process.stderr.write(`${m}\n`),
    };
  }
  const s = p.spinner();
  return {
    start: (m) => s.start(m),
    message: (m) => s.message(m),
    stop: (m) => s.stop(m),
    error: (m) => s.error(m),
  };
}

export { pc };
