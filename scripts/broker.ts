/**
 * Ticket S1-15 — the swarm's message bus. UNBLOCKS S2.
 *
 *   npm run broker
 *
 * Listens on 1883 for the gateway, the simulator and any ESP32 that speaks MQTT, and on
 * 9001 for WebSocket clients — browsers cannot open a raw TCP socket, so the twins
 * dashboard needs the WS listener specifically.
 *
 * WHY NOT MOSQUITTO. The ticket says Mosquitto, and Mosquitto is the right answer for a
 * deployment. For this build it is the wrong one: it means a per-machine install, admin
 * rights on locked-down laptops, a hand-edited config to enable the WebSocket listener,
 * and four people discovering all of that separately at hour 20. Aedes is a broker in a
 * dependency we already install, it starts with `npm run broker` on every machine in the
 * team, and it satisfies invariant 6 — the demo must work with no internet. The wire
 * protocol is MQTT 3.1.1 either way, so swapping Mosquitto back in is a config change and
 * nothing else needs to know.
 *
 * NO AUTHENTICATION, deliberately, and the same reasoning as the gateway's plain HTTP
 * (PROTOCOL.md §3.1): nothing on this bus is secret. Every record and companion carries
 * its own signature, and a subscriber who forges one is caught by the same verification
 * the gateway runs. A publisher cannot inject a believable record without a device key.
 * What an attacker on the LAN *could* do is flood us, which is a venue-network problem we
 * are not pretending to solve.
 */

import { Aedes } from "aedes";
import { createServer } from "aedes-server-factory";

const TCP_PORT = Number(process.env.MQTT_PORT ?? 1883);
const WS_PORT = Number(process.env.MQTT_WS_PORT ?? 9001);

async function main(): Promise<void> {
const broker = await Aedes.createBroker({ id: "krishichain-broker" });

const clients = new Set<string>();

broker.on("client", (client) => {
  clients.add(client.id);
  console.log(`+ ${client.id}  (${clients.size} connected)`);
});

broker.on("clientDisconnect", (client) => {
  clients.delete(client.id);
  console.log(`- ${client.id}  (${clients.size} connected)`);
});

broker.on("clientError", (client, error) => {
  console.warn(`! ${client.id}: ${error.message}`);
});

broker.on("subscribe", (subscriptions, client) => {
  const topics = subscriptions.map((s) => s.topic).join(", ");
  console.log(`  ${client?.id ?? "unknown"} subscribed: ${topics}`);
});

// Publish volume is the useful signal here, not the payloads — a silent dashboard is
// almost always a broker with no publishers, and this line is how you tell in one glance.
let published = 0;
broker.on("publish", (packet, client) => {
  if (client === null) return; // broker's own $SYS traffic
  published += 1;
  if (published % 50 === 1) {
    console.log(`  ${published} messages published (latest: ${packet.topic})`);
  }
});

const tcp = createServer(broker, { ws: false });
tcp.listen(TCP_PORT, () => {
  console.log(`MQTT  tcp://0.0.0.0:${TCP_PORT}   gateway, simulator, ESP32 nodes`);
});

const ws = createServer(broker, { ws: true });
ws.listen(WS_PORT, () => {
  console.log(`MQTT  ws://0.0.0.0:${WS_PORT}     browser dashboard (S2-12)`);
  console.log("\nsubscribe to krishi/v1/# to watch everything.");
});

function shutdown(signal: string): void {
  console.log(`\n${signal} — closing broker`);
  broker.close(() => {
    tcp.close();
    ws.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
