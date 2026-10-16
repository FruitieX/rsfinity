import type { Request, Response, WorkerMessage } from "./protocol";

/** Promise wrapper around the geometry worker. Requests are processed in order. */
export class GeometryClient {
  private worker = new Worker(new URL("./geometry.worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || "The geometry worker crashed.");
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
    };
  }

  call<R extends Request>(req: R): Promise<Response<R>> {
    const id = this.nextId++;
    const transfer = req.type === "load" ? [req.bytes] : [];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, req }, transfer);
    });
  }
}
