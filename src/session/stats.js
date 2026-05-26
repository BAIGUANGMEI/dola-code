export function createSessionStats(initial = {}) {
  return {
    requests: normalizeNumber(initial.requests),
    promptTokens: normalizeNumber(initial.promptTokens),
    completionTokens: normalizeNumber(initial.completionTokens),
    totalTokens: normalizeNumber(initial.totalTokens),
    elapsedMs: normalizeNumber(initial.elapsedMs),

    record({ usage, elapsedMs = 0 }) {
      this.requests += 1;
      this.elapsedMs += elapsedMs;
      if (!usage) return;

      this.promptTokens += usage.prompt_tokens ?? usage.input_tokens ?? 0;
      this.completionTokens += usage.completion_tokens ?? usage.output_tokens ?? 0;
      this.totalTokens += usage.total_tokens ?? 0;
    },

    reset() {
      this.requests = 0;
      this.promptTokens = 0;
      this.completionTokens = 0;
      this.totalTokens = 0;
      this.elapsedMs = 0;
    },

    snapshot() {
      return {
        requests: this.requests,
        promptTokens: this.promptTokens,
        completionTokens: this.completionTokens,
        totalTokens: this.totalTokens,
        elapsedMs: this.elapsedMs
      };
    }
  };
}

export function formatSessionStats(stats) {
  const total = stats.totalTokens || stats.promptTokens + stats.completionTokens;
  return `requests=${stats.requests} prompt=${stats.promptTokens} completion=${stats.completionTokens} total=${total} elapsed=${stats.elapsedMs}ms`;
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
