import { createHash } from "node:crypto";
import { eventsInsideWindow, type FieldEvent, type ReplayRequest } from "./missed_event_policy.ts";
import { InfraiClient } from "./infrai_client.ts";

export interface ReplayResult {
  historyChecked: true;
  replayedEventIds: string[];
  redrivenBatches: number;
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function stableKey(parts: string[]): string {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}

async function postFieldEvent(callbackUrl: string, event: FieldEvent): Promise<void> {
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": stableKey(["field-event", event.eventId])
    },
    body: JSON.stringify(event)
  });
  if (!response.ok) {
    throw new Error(`Field-service callback returned HTTP ${response.status}`);
  }
}

export async function replayMissedWork(
  request: ReplayRequest,
  infrai: InfraiClient
): Promise<ReplayResult> {
  await infrai.deliveryHistory(request.webhookId);

  const selected = eventsInsideWindow(request.events, request.window);
  for (const event of selected) await postFieldEvent(request.callbackUrl, event);

  const spacingMs = 60_000 / request.deadLetters.batchesPerMinute;
  for (let batch = 0; batch < request.deadLetters.batches; batch += 1) {
    await infrai.redriveDeadLetters(
      request.deadLetters.queue,
      stableKey([request.deadLetters.queue, request.window.from, String(batch)])
    );
    if (batch + 1 < request.deadLetters.batches) await sleep(spacingMs);
  }

  return {
    historyChecked: true,
    replayedEventIds: selected.map((event) => event.eventId),
    redrivenBatches: request.deadLetters.batches
  };
}
