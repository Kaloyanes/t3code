export function createTerminalInputQueue<T>(send: (input: T) => Promise<void>) {
  const pending: T[] = [];
  let ready = false;
  let disposed = false;
  let draining = false;

  const drain = async () => {
    if (!ready || disposed || draining) return;
    draining = true;
    try {
      while (pending.length > 0) {
        if (!ready || disposed) break;
        await send(pending.shift()!);
      }
    } finally {
      draining = false;
    }
  };

  return {
    push(input: T) {
      if (disposed) return;
      pending.push(input);
      void drain();
    },
    setReady(value: boolean) {
      ready = value;
      return drain();
    },
    dispose() {
      disposed = true;
      pending.length = 0;
    },
  };
}
