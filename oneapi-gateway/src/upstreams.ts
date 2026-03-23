export type Upstream = {
  baseUrl: string;
};

type State = {
  failures: number;
  openUntilMs: number;
};

export class UpstreamPool {
  private readonly upstreams: Upstream[];
  private cursor = 0;
  private readonly state = new Map<string, State>();
  private readonly failureThreshold: number;
  private readonly openMs: number;

  constructor(baseUrls: string[], failureThreshold = 5, openMs = 10_000) {
    this.upstreams = baseUrls.map((u) => ({ baseUrl: u.replace(/\/+$/, "") }));
    this.failureThreshold = failureThreshold;
    this.openMs = openMs;
  }

  list(): Upstream[] {
    return this.upstreams.slice();
  }

  pick(nowMs: number): Upstream | undefined {
    const n = this.upstreams.length;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor + i) % n;
      const u = this.upstreams[idx]!;
      const st = this.state.get(u.baseUrl);
      if (st && st.openUntilMs > nowMs) continue;
      this.cursor = (idx + 1) % n;
      return u;
    }
    return;
  }

  reportSuccess(baseUrl: string): void {
    this.state.set(baseUrl, { failures: 0, openUntilMs: 0 });
  }

  reportFailure(baseUrl: string, nowMs: number): void {
    const prev = this.state.get(baseUrl) ?? { failures: 0, openUntilMs: 0 };
    const failures = prev.failures + 1;
    const openUntilMs = failures >= this.failureThreshold ? nowMs + this.openMs : 0;
    this.state.set(baseUrl, { failures, openUntilMs });
  }
}

