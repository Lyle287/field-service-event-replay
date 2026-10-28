import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { replayRequestSchema } from "./missed_event_policy.ts";
import { InfraiClient, InfraiError } from "./infrai_client.ts";
import { replayMissedWork } from "./replay_coordinator.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const infrai = new InfraiClient(apiKey);
const port = Number(process.env.PORT ?? 3000);

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/replay-field-events") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const parsed = replayRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      send(response, 400, { error: "Invalid replay request", issues: parsed.error.issues });
      return;
    }

    const result = await replayMissedWork(parsed.data, infrai);
    send(response, 200, result);
  } catch (error) {
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.message, code: error.code });
      return;
    }
    send(response, 502, { error: error instanceof Error ? error.message : "Replay failed" });
  }
});

server.listen(port, () => {
  console.log(`Field event replay listening on http://localhost:${port}`);
});
