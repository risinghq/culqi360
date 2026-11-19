import type { Kysely } from "kysely";

type Effect = () => void;

// Work that must follow a commit and never a rollback: a realtime message
// describes committed state. The driver's lock lets one transaction be open
// per store, so an executor that is a transaction is the open one.
export class CommitEffects {
  private pending: Effect[] | undefined;
  private readonly listeners = new Set<Effect>();

  begin(): void {
    this.pending = [];
  }

  commit(): void {
    const effects = this.pending ?? [];
    this.pending = undefined;
    for (const effect of [...effects, ...this.listeners]) {
      runEffect(effect);
    }
  }

  // Runs after every committed transaction, for a reader that follows what the
  // store appended rather than what one writer said it wrote.
  onCommit(listener: Effect): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  rollback(): void {
    this.pending = undefined;
  }

  after(executor: Kysely<any>, effect: Effect): void {
    if (!executor.isTransaction) {
      runEffect(effect);
      return;
    }
    if (!this.pending) {
      throw new Error("commit_effects_no_open_transaction");
    }
    this.pending.push(effect);
  }
}

// The data is already committed, so a failing effect cannot undo it and must
// not reach the driver as a failed commit.
function runEffect(effect: Effect): void {
  try {
    effect();
  } catch (error: unknown) {
    reportError(error);
  }
}
