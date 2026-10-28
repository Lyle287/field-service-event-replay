import { z } from "zod";

export const fieldEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("work_order.photo_added"),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime(),
    workOrderId: z.string().min(1),
    photoId: z.string().min(1),
    objectUrl: z.string().url()
  }),
  z.object({
    type: z.literal("dispatch.status_changed"),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime(),
    workOrderId: z.string().min(1),
    dispatchId: z.string().min(1),
    status: z.enum(["assigned", "en_route", "on_site", "completed"])
  }),
  z.object({
    type: z.literal("technician.follow_up_requested"),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime(),
    workOrderId: z.string().min(1),
    technicianId: z.string().min(1),
    dueAt: z.string().datetime(),
    note: z.string().min(1)
  })
]);

export type FieldEvent = z.infer<typeof fieldEventSchema>;

export const replayRequestSchema = z.object({
  webhookId: z.string().min(1),
  callbackUrl: z.string().url(),
  window: z.object({
    from: z.string().datetime(),
    to: z.string().datetime()
  }),
  events: z.array(fieldEventSchema).min(1),
  deadLetters: z.object({
    queue: z.string().min(1),
    batches: z.number().int().min(0).max(20),
    batchesPerMinute: z.number().int().min(1).max(60)
  })
}).superRefine((request, context) => {
  if (Date.parse(request.window.from) >= Date.parse(request.window.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["window", "to"],
      message: "window.to must be later than window.from"
    });
  }
});

export type ReplayRequest = z.infer<typeof replayRequestSchema>;

export function eventsInsideWindow(
  events: FieldEvent[],
  window: ReplayRequest["window"]
): FieldEvent[] {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  const unique = new Map<string, FieldEvent>();

  for (const event of events) {
    const occurredAt = Date.parse(event.occurredAt);
    if (occurredAt >= from && occurredAt < to && !unique.has(event.eventId)) {
      unique.set(event.eventId, event);
    }
  }

  return Array.from(unique.values()).sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
  );
}
