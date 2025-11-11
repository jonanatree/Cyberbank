import type { FastifyReply } from "fastify";

type Event = Record<string, any>;

interface Subscriber {
  id: string;
  userId: string;
  reply: FastifyReply;
  heartbeat: NodeJS.Timeout;
}

const subs = new Map<string, Set<Subscriber>>(); // userId -> set of subs

function writeSSE(reply: FastifyReply, data: Event) {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export const Push = {
  add(userId: string, reply: FastifyReply) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // flush headers if supported
    (reply.raw as any).flushHeaders?.();
    // initial event
    writeSSE(reply, { type: "hello", userId, ts: Date.now() });

    const s: Subscriber = {
      id: Math.random().toString(36).slice(2),
      userId,
      reply,
      heartbeat: setInterval(() => {
        try { writeSSE(reply, { type: "ping", ts: Date.now() }); } catch { /* ignore */ }
      }, 30000),
    };
    const set = subs.get(userId) ?? new Set<Subscriber>();
    set.add(s);
    subs.set(userId, set);

    reply.raw.on("close", () => {
      clearInterval(s.heartbeat);
      const set2 = subs.get(userId);
      if (set2) {
        set2.delete(s);
        if (set2.size === 0) subs.delete(userId);
      }
    });

    return s.id;
  },
  notify(userId: string, event: Event) {
    const set = subs.get(userId);
    if (!set) return 0;
    let n = 0;
    for (const s of set) {
      try { writeSSE(s.reply, event); n++; } catch { /* ignore */ }
    }
    return n;
  },
};
