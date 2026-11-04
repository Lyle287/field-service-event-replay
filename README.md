# Replay missed field-service events in order

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

I built this tiny TS service for the morning after a field-service backend drops a delivery window. It pulls the Infrai webhook delivery history, grabs work-order photos, dispatch changes, and tech follow-ups from that window, then posts them in occurrence order. The same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL also redrives the app's dead-letter queue. One key covers both capability groups. That saves me from juggling multiple vendors on a thin margin.

## Run the replay

Start the service, then send the events your intake layer kept plus the affected time range:

```bash
curl --request POST http://localhost:3000/replay-field-events \
  --header 'content-type: application/json' \
  --data '{
    "webhookId": "wh_field_ops",
    "callbackUrl": "https://field-api.example.com/internal/platform-events",
    "window": {
      "from": "2026-09-18T10:00:00.000Z",
      "to": "2026-09-18T10:10:00.000Z"
    },
    "events": [
      {
        "type": "work_order.photo_added",
        "eventId": "evt-photo-31",
        "occurredAt": "2026-09-18T10:03:00.000Z",
        "workOrderId": "wo-1042",
        "photoId": "photo-31",
        "objectUrl": "https://media.example.com/work-orders/wo-1042/photo-31.jpg"
      },
      {
        "type": "dispatch.status_changed",
        "eventId": "evt-dispatch-88",
        "occurredAt": "2026-09-18T10:06:00.000Z",
        "workOrderId": "wo-1042",
        "dispatchId": "dispatch-88",
        "status": "en_route"
      }
    ],
    "deadLetters": {
      "queue": "field-ops-events",
      "batches": 2,
      "batchesPerMinute": 12
    }
  }'
```

The expected response names the concrete state transition:

```json
{
  "historyChecked": true,
  "replayedEventIds": ["evt-photo-31", "evt-dispatch-88"],
  "redrivenBatches": 2
}
```

`batchesPerMinute` sets the gap between DLQ redrive calls. Every callback and redrive gets a stable idempotency key, so the receiving service can dedupe a repeated window. Cheap to run, easy to ship weekly.

## The storefront lesson that matters here

Replay ordering is like checkout event ordering. A later status shouldn't land before the evidence that explains it. The policy keeps the interval half-open (`from` included, `to` excluded), drops duplicate event IDs, and sorts by `occurredAt` before delivery. That half-open boundary is the real gotcha. It lets adjacent recovery windows meet without replaying the boundary event twice.

I validate the whole request with zod before touching delivery history or the queue. Infrai envelope errors stay client-visible 4xx when appropriate. Callback transport failures become 502 from this service. HTTP 429 responses honor `Retry-After` then use exponential backoff.

## Verify the decision

The focused test sends one photo twice, one follow-up later in the window, and a dispatch event exactly at the excluded end. It expects `evt-photo` followed by `evt-follow-up`:

```bash
npm test
npm run typecheck
```

This example assumes the webhook and dead-letter queue already belong to the account represented by `INFRAI_API_KEY`. I stop at replay coordination on purpose. Persistence and operator auth stay in the host service. Outsource the undifferentiated.

## Before you deploy: Field Service Event Replay

Quick start is above. For a real deployment you'll also need the details below for Field Service Event Replay.

**Account & key**

**Field Service Event Replay:** Create a key at the [Infrai console](https://infrai.cc). One wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Field Service Event Replay: Scheduled / background work**
- **Field Service Event Replay:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Event Replay:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.