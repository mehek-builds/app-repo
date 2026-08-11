export class KeyedMutationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(() => undefined, () => undefined);
    this.tails.set(key, settled);
    void settled.finally(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return result;
  }
}

export async function persistOneShotTransition<T>(input: {
  before: T;
  after: T;
  persistSource: (value: T) => Promise<void>;
  persistDestination: () => Promise<void>;
}): Promise<void> {
  await input.persistSource(input.after);
  try {
    await input.persistDestination();
  } catch (error) {
    await input.persistSource(input.before);
    throw error;
  }
}
