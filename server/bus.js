// Event bus. In-process by default; swap `transport` for Redis pub/sub or NATS to fan out across instances.
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export const EVENT_TYPES = ["signal", "lead", "monitor", "package", "touch", "reply", "booked", "config"];

export function createBus({ historySize = 500 } = {}) {
  const em = new EventEmitter();
  em.setMaxListeners(0);
  const history = [];
  return {
    publish(type, data) {
      const evt = { id: randomUUID(), type, at: new Date().toISOString(), data };
      history.push(evt);
      if (history.length > historySize) history.shift();
      em.emit("event", evt);
      return evt;
    },
    subscribe(fn) { em.on("event", fn); return () => em.off("event", fn); },
    recent(n = 100, types) { return history.filter(e => !types || types.includes(e.type)).slice(-n); }
  };
}
