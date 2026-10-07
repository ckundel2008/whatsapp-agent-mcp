import type { Logger } from "pino";

export class AlertManager {
  private readonly lastSent = new Map<string, number>();
  private authFailures: number[] = [];
  constructor(private readonly webhookUrl: string | null, private readonly logger: Logger) {}
  authFailure(): void {
    const now = Date.now();
    this.authFailures = this.authFailures.filter((timestamp) => timestamp > now - 5 * 60_000);
    this.authFailures.push(now);
    if (this.authFailures.length >= 5) void this.notify("repeated_oauth_failures", { count: this.authFailures.length });
  }
  async notify(kind: string, details: Record<string, string | number | boolean | null> = {}): Promise<void> {
    const last = this.lastSent.get(kind) ?? 0;
    if (Date.now() - last < 5 * 60_000) return;
    this.lastSent.set(kind, Date.now());
    this.logger.warn({ event: "alert", kind, ...details }, "Connector alert");
    if (!this.webhookUrl) return;
    try {
      const response = await fetch(this.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ service: "whatsapp-connector", kind, details, timestamp: new Date().toISOString() }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
    } catch (error) {
      this.logger.error({ event: "alert_delivery_failed", kind, error: String(error) }, "Could not deliver connector alert");
    }
  }
}
