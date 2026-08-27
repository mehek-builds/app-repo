export class SubmissionStartGate {
  private closed = false;
  private active = 0;
  private drainResolvers: Array<() => void> = [];

  begin(): () => void {
    if (this.closed) throw new Error('Litos is signing out. No employer submission can start.');
    if (this.active > 0) throw new Error('Another employer submission is already being prepared. Try this one again after it finishes.');
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      if (this.active === 0) {
        const resolvers = this.drainResolvers;
        this.drainResolvers = [];
        resolvers.forEach((resolve) => resolve());
      }
    };
  }

  async closeAndDrain(): Promise<void> {
    this.closed = true;
    if (this.active === 0) return;
    await new Promise<void>((resolve) => this.drainResolvers.push(resolve));
  }

  reopen(): void {
    this.closed = false;
  }

  state(): { closed: boolean; active: number } {
    return { closed: this.closed, active: this.active };
  }
}
