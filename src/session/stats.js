export function createSessionStats() {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    elapsedMs: 0,

    record({ usage, elapsedMs = 0 }) {
      this.requests += 1;
      this.elapsedMs += elapsedMs;
      if (!usage) return;

      this.promptTokens += usage.prompt_tokens ?? usage.input_tokens ?? 0;
      this.completionTokens += usage.completion_tokens ?? usage.output_tokens ?? 0;
      this.totalTokens += usage.total_tokens ?? 0;
    }
  };
}

export function formatSessionStats(stats) {
  const total = stats.totalTokens || stats.promptTokens + stats.completionTokens;
  return `requests=${stats.requests} prompt=${stats.promptTokens} completion=${stats.completionTokens} total=${total} elapsed=${stats.elapsedMs}ms`;
}
