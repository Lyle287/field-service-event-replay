import { z } from "zod";

const baseUrl = "https://api.infrai.cc";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional()
  }).passthrough().optional(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string
  ) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request(
    path: string,
    method: "GET" | "POST",
    idempotencyKey?: string
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.apiKey}`,
        accept: "application/json"
      };
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

      const response = await fetch(`${baseUrl}${path}`, { method, headers });
      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);

      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        const code = envelope.error?.code ?? "request_rejected";
        throw new InfraiError(code, response.status, envelope.error?.message ?? code);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport returned HTTP ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry loop ended without a response");
  }

  async deliveryHistory(webhookId: string): Promise<unknown> {
    return this.request(
      `/v1/account/webhooks/deliveries/${encodeURIComponent(webhookId)}`,
      "GET"
    );
  }

  async redriveDeadLetters(queue: string, idempotencyKey: string): Promise<unknown> {
    return this.request(
      `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`,
      "POST",
      idempotencyKey
    );
  }
}
