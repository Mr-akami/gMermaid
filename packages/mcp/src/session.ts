import { randomUUID } from "node:crypto";
import type { DiagramKind } from "@gmermaid/app/review";

export interface ReviewSession {
  readonly id: string;
  readonly token: string;
  readonly kind: DiagramKind;
  readonly originalMermaid: string;
  readonly title?: string | undefined;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly confirmedMermaid?: string | undefined;
}

export type ReviewResult =
  | { readonly status: "pending"; readonly sessionId: string; readonly kind: DiagramKind }
  | { readonly status: "expired"; readonly sessionId: string }
  | {
      readonly status: "confirmed";
      readonly sessionId: string;
      readonly kind: DiagramKind;
      readonly mermaid: string;
      readonly changed: boolean;
    };

export class SessionStore {
  readonly #sessions = new Map<string, ReviewSession>();
  readonly #waiters = new Map<string, Set<() => void>>();

  constructor(
    private readonly ttlMs = 30 * 60_000,
    private readonly maxSessions = 20,
    private readonly now: () => number = Date.now,
  ) {}

  create(kind: DiagramKind, mermaid: string, title?: string): ReviewSession {
    this.#purgeExpired();
    if (this.#sessions.size >= this.maxSessions) throw new Error("Too many active review sessions");
    const id = randomUUID();
    const session: ReviewSession = {
      id,
      token: randomUUID(),
      kind,
      originalMermaid: mermaid,
      ...(title === undefined ? {} : { title }),
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
    };
    this.#sessions.set(id, session);
    return session;
  }

  getSession(id: string, token?: string): ReviewSession | undefined {
    this.#purgeExpired();
    const session = this.#sessions.get(id);
    if (session === undefined || (token !== undefined && token !== session.token)) return undefined;
    return session;
  }

  confirm(id: string, mermaid: string, token?: string): ReviewResult {
    const session = this.getSession(id, token);
    if (session === undefined) return { status: "expired", sessionId: id };
    if (session.confirmedMermaid !== undefined && session.confirmedMermaid !== mermaid) {
      throw new Error("This review was already confirmed with different content");
    }
    const confirmed = session.confirmedMermaid === undefined ? { ...session, confirmedMermaid: mermaid } : session;
    this.#sessions.set(id, confirmed);
    for (const wake of this.#waiters.get(id) ?? []) wake();
    this.#waiters.delete(id);
    return this.result(id);
  }

  result(id: string): ReviewResult {
    const session = this.getSession(id);
    if (session === undefined) return { status: "expired", sessionId: id };
    if (session.confirmedMermaid === undefined) return { status: "pending", sessionId: id, kind: session.kind };
    return {
      status: "confirmed",
      sessionId: id,
      kind: session.kind,
      mermaid: session.confirmedMermaid,
      changed: session.confirmedMermaid !== session.originalMermaid,
    };
  }

  async wait(id: string, waitMs: number): Promise<ReviewResult> {
    const current = this.result(id);
    if (current.status !== "pending" || waitMs <= 0) return current;
    await new Promise<void>((resolve) => {
      const waiters = this.#waiters.get(id) ?? new Set<() => void>();
      waiters.add(resolve);
      this.#waiters.set(id, waiters);
      const timer = setTimeout(() => {
        waiters.delete(resolve);
        if (waiters.size === 0) this.#waiters.delete(id);
        resolve();
      }, waitMs);
      timer.unref();
    });
    return this.result(id);
  }

  #purgeExpired(): void {
    const now = this.now();
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(id);
        for (const wake of this.#waiters.get(id) ?? []) wake();
        this.#waiters.delete(id);
      }
    }
  }
}
