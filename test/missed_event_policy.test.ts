import assert from "node:assert/strict";
import test from "node:test";
import { eventsInsideWindow, fieldEventSchema } from "../src/missed_event_policy.ts";

test("selects, orders, and deduplicates field events inside the missed window", () => {
  const events = [
    {
      type: "technician.follow_up_requested",
      eventId: "evt-follow-up",
      occurredAt: "2026-09-18T10:08:00.000Z",
      workOrderId: "wo-1042",
      technicianId: "tech-7",
      dueAt: "2026-09-19T09:00:00.000Z",
      note: "Confirm the replacement seal holds"
    },
    {
      type: "work_order.photo_added",
      eventId: "evt-photo",
      occurredAt: "2026-09-18T10:03:00.000Z",
      workOrderId: "wo-1042",
      photoId: "photo-31",
      objectUrl: "https://media.example.test/work-orders/wo-1042/photo-31.jpg"
    },
    {
      type: "work_order.photo_added",
      eventId: "evt-photo",
      occurredAt: "2026-09-18T10:03:00.000Z",
      workOrderId: "wo-1042",
      photoId: "photo-31",
      objectUrl: "https://media.example.test/work-orders/wo-1042/photo-31.jpg"
    },
    {
      type: "dispatch.status_changed",
      eventId: "evt-late",
      occurredAt: "2026-09-18T10:10:00.000Z",
      workOrderId: "wo-1042",
      dispatchId: "dispatch-88",
      status: "on_site"
    }
  ].map((event) => fieldEventSchema.parse(event));

  const selected = eventsInsideWindow(events, {
    from: "2026-09-18T10:00:00.000Z",
    to: "2026-09-18T10:10:00.000Z"
  });

  assert.deepEqual(selected.map((event) => event.eventId), ["evt-photo", "evt-follow-up"]);
});
