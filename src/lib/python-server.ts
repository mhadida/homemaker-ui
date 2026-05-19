/**
 * Long-running Python subprocess that serves Homemaker pipeline requests.
 *
 * Survives Next.js HMR via a globalThis singleton. Auto-spawns on first
 * request and respawns if the child dies. Requests are queued and processed
 * one at a time (Molior is not thread-safe within a single process).
 */

import { spawn, type ChildProcessByStdio } from "child_process";
import path from "path";
import { Readable, Writable } from "stream";

const REPO_ROOT = process.cwd();
const PYTHON_BIN = path.join(REPO_ROOT, "python", ".venv", "bin", "python");
const SERVER_SCRIPT = path.join(REPO_ROOT, "python", "server.py");
const ADDON_ROOT = path.resolve(REPO_ROOT, "..", "homemaker-addon");

type PendingResolver = {
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
};

class PyServer {
  private child:
    | ChildProcessByStdio<Writable, Readable, Readable>
    | null = null;
  private ready: Promise<void> | null = null;
  private queue: PendingResolver[] = [];
  private rxBuf = Buffer.alloc(0);

  private spawn() {
    const c = spawn(PYTHON_BIN, [SERVER_SCRIPT], {
      env: { ...process.env, PYTHONPATH: ADDON_ROOT, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child = c;
    this.rxBuf = Buffer.alloc(0);

    this.ready = new Promise<void>((resolve, reject) => {
      const onStderr = (data: Buffer) => {
        const text = data.toString("utf-8");
        if (text.includes("READY")) {
          c.stderr.off("data", onStderr);
          resolve();
        }
        // Forward server diagnostics to Next.js console
        process.stderr.write(`[py] ${text}`);
      };
      c.stderr.on("data", onStderr);

      c.on("error", (err) => {
        c.stderr.off("data", onStderr);
        reject(err);
      });
      c.on("exit", (code, signal) => {
        c.stderr.off("data", onStderr);
        const reason = `python server exited code=${code} signal=${signal}`;
        const pending = this.queue.splice(0);
        for (const p of pending) p.reject(new Error(reason));
        if (this.child === c) {
          this.child = null;
          this.ready = null;
        }
      });
    });

    c.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    c.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[py] ${chunk.toString("utf-8")}`);
    });
  }

  private onStdout(chunk: Buffer) {
    this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
    while (this.rxBuf.length >= 5) {
      const kind = this.rxBuf.readUInt8(0);
      const len = this.rxBuf.readUInt32LE(1);
      if (this.rxBuf.length < 5 + len) return;
      const payload = this.rxBuf.subarray(5, 5 + len);
      this.rxBuf = this.rxBuf.subarray(5 + len);

      const pending = this.queue.shift();
      if (!pending) {
        process.stderr.write(`[py] orphan response kind=${kind} len=${len}\n`);
        continue;
      }
      if (kind === 0) {
        pending.resolve(Buffer.from(payload));
      } else {
        pending.reject(new Error(payload.toString("utf-8").slice(0, 2000)));
      }
    }
  }

  async generate(params: unknown): Promise<Buffer> {
    if (!this.child || !this.ready) this.spawn();
    await this.ready!;
    const body = Buffer.from(JSON.stringify(params), "utf-8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);

    return new Promise<Buffer>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      const child = this.child;
      if (!child) {
        this.queue.pop();
        reject(new Error("python child not running"));
        return;
      }
      child.stdin.write(header);
      child.stdin.write(body);
    });
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __homemakerPyServer: PyServer | undefined;
}

export const pyServer: PyServer =
  globalThis.__homemakerPyServer ?? (globalThis.__homemakerPyServer = new PyServer());
