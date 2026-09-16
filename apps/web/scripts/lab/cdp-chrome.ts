/**
 * cdp-chrome.ts — Chrome headless dirigido pelo DevTools Protocol, sem Playwright
 * (o Node 24 desta maquina o recusa) e sem dependencia nova: WebSocket nativo do
 * Node e o binario do Chrome instalado.
 *
 * Compartilhado pelos laboratorios locais: `perf-lab-chrome.ts` (desempenho) e
 * `css-parity-chrome.ts` (paridade de estilo computado).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export const DEFAULT_CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

export type Params = Record<string, unknown>;

/** Cliente minimo do DevTools Protocol sobre um alvo (aba). */
export class Cdp {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { readonly resolve: (value: Params) => void; readonly reject: (error: Error) => void }
  >();
  private readonly listeners = new Map<string, Array<(params: Params) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Params;
        error?: { message: string };
        method?: string;
        params?: Params;
      };
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        if (waiter === undefined) return;
        this.pending.delete(message.id);
        if (message.error !== undefined) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result ?? {});
        return;
      }
      if (message.method === undefined) return;
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error(`CDP: sem conexao em ${url}`)));
    });
    return new Cdp(socket);
  }

  send(method: string, params: Params = {}): Promise<Params> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method: string, listener: (params: Params) => void): void {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  /** Tira UM ouvinte — `clear` tiraria tambem os de quem mais escuta o mesmo evento. */
  off(method: string, listener: (params: Params) => void): void {
    this.listeners.set(
      method,
      (this.listeners.get(method) ?? []).filter((registered) => registered !== listener),
    );
  }

  clear(method: string): void {
    this.listeners.delete(method);
  }

  close(): void {
    this.socket.close();
  }
}

/**
 * Responde uma requisicao pausada pelo dominio Fetch: segue se `allow(url)`, recusa
 * se nao. Devolve se seguiu.
 *
 * A navegacao seguinte pode cancelar a requisicao antes de a resposta chegar ao
 * Chrome. Medido: "Invalid InterceptionId" rejeitou a promessa e, sem tratamento,
 * a rejeicao derrubou uma captura de paridade de 38 rotas no Node 24. Esse caso, e
 * so ele, e esperado; qualquer outro erro sai como aviso.
 */
export function answerPausedRequest(cdp: Cdp, params: Params, allow: (url: string) => boolean): boolean {
  const url = (params.request as { url: string }).url;
  const requestId = String(params.requestId);
  const allowed = allow(url);
  const reply = allowed
    ? cdp.send("Fetch.continueRequest", { requestId })
    : cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
  reply.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Invalid InterceptionId/i.test(message)) {
      console.warn(`[aviso] Fetch.${allowed ? "continueRequest" : "failRequest"}: ${message} (${url})`);
    }
  });
  return allowed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** A porta de depuracao ja responde? Recusa de conexao aqui e o Chrome ainda subindo. */
async function devtoolsReady(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
  } catch {
    return false;
  }
}

export interface LaunchedChrome {
  readonly proc: ChildProcess;
  readonly port: number;
  readonly userDataDir: string;
}

export async function launchChrome(chrome: string, dirPrefix: string): Promise<LaunchedChrome> {
  const port = await freePort();
  const userDataDir = mkdtempSync(path.join(tmpdir(), dirPrefix));
  const proc = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await devtoolsReady(port)) return { proc, port, userDataDir };
    await sleep(250);
  }
  proc.kill();
  throw new Error(`o Chrome nao abriu a porta de depuracao em 30 s (${chrome})`);
}

/** Abre uma aba nova e conecta nela. */
export async function openTab(port: number): Promise<Cdp> {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = (await created.json()) as { webSocketDebuggerUrl: string };
  return Cdp.connect(target.webSocketDebuggerUrl);
}

/**
 * Encerra o Chrome e apaga o perfil temporario.
 *
 * No Windows os processos-filho do Chrome seguram arquivos do perfil por alguns
 * instantes depois do `kill` — medido: `EPERM` no `rm` ao fim de uma captura longa.
 * Espera o processo sair, tenta de novo por alguns segundos e, se ainda assim o
 * sistema nao soltar o diretorio, AVISA com o caminho: um perfil temporario
 * esquecido em %TEMP% nao invalida a medicao que ja foi gravada.
 */
export async function closeChrome(chrome: LaunchedChrome): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    if (chrome.proc.exitCode !== null) resolve();
    else chrome.proc.once("exit", () => resolve());
  });
  chrome.proc.kill();
  await Promise.race([exited, sleep(5_000)]);
  try {
    rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  } catch (error) {
    console.warn(
      `[aviso] perfil temporario do Chrome nao removido (${(error as Error).message.split("\n")[0]}): ` +
        `${chrome.userDataDir} — sera limpo pelo sistema`,
    );
  }
}
