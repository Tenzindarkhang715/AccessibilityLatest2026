export async function navigateWithNetworkRetry(options: {
  timeoutMs: number;
  check: () => void;
  navigate: (timeoutMs: number, attempt: number) => Promise<unknown>;
}): Promise<void> {
  const deadline = performance.now() + options.timeoutMs;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    options.check();
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error("Navigation timeout exhausted.");
    try {
      await options.navigate(remaining, attempt);
      options.check();
      return;
    } catch (error) {
      options.check();
      const networkChanged = error instanceof Error &&
        /\bnet::ERR_NETWORK_CHANGED\b/.test(error.message);
      if (!networkChanged || attempt === 1 ||
          performance.now() >= deadline) throw error;
    }
  }
}
