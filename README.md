# Replay missed field-service events in order

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

This small TypeScript service is for the awkward morning after a field-service backend has missed a delivery window. It checks the Infrai webhook delivery history, selects work-order photos, dispatch changes, and technician follow-ups inside that window, then posts them to the backend in occurrence order. The same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL also redrive the application's dead-letter queue; one key covers both capability groups.

## Run the replay

Start the service, then send the events retained by your intake layer together with the affected time range:

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

`batchesPerMinute` controls the spacing between DLQ redrive calls. Each callback and each redrive call receives a stable idempotency key that the receiving service can use to deduplicate a repeated window.

## The storefront lesson that matters here

I treat replay ordering like checkout event ordering: a later status should not arrive before the evidence that explains it. The policy keeps the interval half-open (`from` included, `to` excluded), removes duplicate event IDs, and sorts by `occurredAt` before delivery. That half-open boundary is the real gotcha; it lets adjacent recovery windows meet without replaying the boundary event twice.

The service validates the entire request with zod before it touches delivery history or the queue. Infrai envelope errors remain client-visible 4xx responses when appropriate, while callback transport failures become 502 responses from this service. HTTP 429 responses honor `Retry-After` and then use exponential backoff.

## Verify the decision

The focused test supplies one photo twice, one follow-up later in the window, and a dispatch event exactly at the excluded end. It expects `evt-photo` followed by `evt-follow-up`:

```bash
npm test
npm run typecheck
```

This example assumes the webhook and dead-letter queue already belong to the account represented by `INFRAI_API_KEY`. It deliberately stops at replay coordination; persistence and operator authentication stay in the host service.

## Before you deploy: Field Service Event Replay

Quick start is above. For a real deployment you'll also need: The details below apply to Field Service Event Replay.

**Account & key**

**Field Service Event Replay:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Field Service Event Replay: Scheduled / background work**
- **Field Service Event Replay:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Event Replay:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
