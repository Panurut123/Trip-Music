import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { validateSourceUrl } from "@trip-music/shared";
import { isLocalMediaTestEnabled, tabletConfig } from "./config.js";
import { TripWorker } from "./worker.js";


const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const mime = (file: string) => file.endsWith(".mp4") ? "video/mp4" : file.endsWith(".webm") ? "video/webm" : file.endsWith(".mp3") ? "audio/mpeg" : file.endsWith(".m4a") ? "audio/mp4" : file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "audio/wav";
const networkAddresses = () => Object.values(os.networkInterfaces()).flatMap((value) => value ?? []).filter((address) => address.family === "IPv4" && !address.internal).map((address) => address.address);

function serveFileWithRange(req: Request, res: Response, file: string) {
  if (!fs.existsSync(file)) return res.status(404).end();
  const stat = fs.statSync(file), range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes"); res.setHeader("Content-Type", mime(file));
  if (!range) { res.setHeader("Content-Length", stat.size); return fs.createReadStream(file).pipe(res); }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) return res.status(416).end();
  const start = match[1] ? Number(match[1]) : 0, end = match[2] ? Number(match[2]) : stat.size - 1;
  if (start > end || start >= stat.size) return res.status(416).end();
  res.status(206).set({ "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) });
  return fs.createReadStream(file, { start, end }).pipe(res);
}

function cookieValue(req: Request, name: string) {
  const match = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function createServer(worker: TripWorker, options: { displayToken?: string } = {}) {
  const app = express(), clients = new Set<Response>();
  const displayToken = options.displayToken ?? crypto.randomBytes(32).toString("base64url");
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") return res.status(200).end();
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  const push = () => { const payload = `data: ${JSON.stringify({ state: worker.state, queue: worker.getQueue() })}\n\n`; clients.forEach((client) => client.write(payload)); };

  worker.onChange(push);
  const grantDisplaySession = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Set-Cookie", `trip_display=${encodeURIComponent(displayToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`); next();
  };
  const displaySession: express.RequestHandler = (req, res, next) => {
    const supplied = cookieValue(req, "trip_display");
    if (supplied && supplied.length === displayToken.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(displayToken))) return next();
    return res.status(401).json({ error: "Bus display session required" });
  };

  app.get("/", (_req, res) => res.redirect("/player"));
  app.get("/favicon.ico", (_req, res) => res.status(204).end());
  app.get("/player", grantDisplaySession, (_req, res) => res.sendFile(path.join(publicDir, "player.html")));
  app.get("/control", grantDisplaySession, (_req, res) => res.sendFile(path.join(publicDir, "control.html")));
  app.get("/diagnostics", grantDisplaySession, (_req, res) => res.sendFile(path.join(publicDir, "diagnostics.html")));
  app.use(express.static(publicDir));
  app.get("/api/health", (_req, res) => res.json({
    server: true,
    worker: Boolean(worker.state.workerLastSeen),
    supabase: Boolean(worker.hasSupabase() && worker.state.internetOnline),
    internetOnline: worker.state.internetOnline,
    localAddresses: networkAddresses(),
    playerUrls: networkAddresses().map((ip) => `http://${ip}:${tabletConfig.port}/player`),
    cache: worker.state.cachedTrackCount,
    bufferSeconds: worker.state.preparedBufferSeconds,
    updatedAt: worker.state.updatedAt,
  }));
  app.get("/api/state", (_req, res) => res.json(worker.state));
  app.get("/api/queue", (_req, res) => res.json(worker.getQueue()));
  app.get("/api/network", (_req, res) => res.json({ addresses: networkAddresses(), port: tabletConfig.port, playerUrls: networkAddresses().map((ip) => `http://${ip}:${tabletConfig.port}/player`) }));
  app.get("/events", (req, res) => { res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }); res.flushHeaders(); clients.add(res); res.write(`data: ${JSON.stringify({ state: worker.state, queue: worker.getQueue() })}\n\n`); req.on("close", () => clients.delete(res)); });
  const queueRequestGuard: express.RequestHandler = (req, res, next) => {
    // Public student requests belong on the Supabase-authenticated web flow.
    // The LAN endpoint is intentionally only open during local development/tests;
    // in production it requires the bus display session so passengers cannot bypass PIN/limits.
    if (process.env.NODE_ENV !== "production" || isLocalMediaTestEnabled()) return next();
    return displaySession(req, res, next);
  };
  app.post("/api/queue/request", queueRequestGuard, async (req, res) => {
    const { sourceUrl, requestedMode, requesterNickname, seatNo } = req.body ?? {};
    const safe = validateSourceUrl(sourceUrl, { allowLocalhost: isLocalMediaTestEnabled(), allowMock: isLocalMediaTestEnabled() || process.env.NODE_ENV !== "production" });
    if (!safe.ok) return res.status(400).json({ error: safe.reason });
    const item = await worker.enqueueRequest({ sourceUrl: safe.normalized, requestedMode, requesterNickname, seatNo });
    push();
    res.json(item);
  });
  app.post("/api/reset", displaySession, (_req, res) => {
    worker.reset();
    push();
    res.json({ ok: true });
  });






  app.post("/api/player/start", displaySession, async (_req, res) => { const item = await worker.startTrip(); push(); res.json(item ?? { error: "No prepared track", state: worker.state }); });
  app.post("/api/player/pause", displaySession, (_req, res) => { worker.pause(); push(); res.json(worker.state); });
  app.post("/api/player/resume", displaySession, (_req, res) => { worker.resume(); push(); res.json(worker.state); });
  app.post("/api/player/skip", displaySession, async (_req, res) => {
    const before = worker.state.currentQueueItemId;
    const next = await worker.skip();
    push();
    const skipped = Boolean(before && worker.state.currentQueueItemId && worker.state.currentQueueItemId !== before);
    res.json({ skipped, item: next, reason: skipped ? null : "next_not_ready", state: worker.state });
  });
  app.post("/api/player/ended", displaySession, async (_req, res) => { const next = await worker.ended(); push(); res.json({ item: next, state: worker.state }); });
  app.post("/api/player/error", displaySession, async (req, res) => {
    const next = await worker.failCurrent(req.body?.code ?? "unknown");
    push();
    res.json({ item: next, state: worker.state });
  });
  app.post("/api/player/progress", displaySession, (req, res) => { worker.updatePlaybackPosition(Number(req.body?.positionSeconds ?? 0)); res.json(worker.state); });
  app.get("/media/:mediaKey", (req, res) => { const file = worker.cache.mediaPath(req.params.mediaKey); if (!file) return res.status(400).end(); serveFileWithRange(req, res, file); });
  app.get("/covers/:coverKey", (req, res) => { const file = worker.cache.coverPath(req.params.coverKey); if (!file) return res.status(400).end(); serveFileWithRange(req, res, file); });
  app.get("/api/test-tone", (_req, res) => res.sendFile(worker.cache.ensureTestTone()));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { console.error(error); res.status(500).json({ error: "Internal server error" }); });
  return app;
}

export async function startServer(worker: TripWorker) {
  const app = createServer(worker);
  return new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(tabletConfig.port, tabletConfig.host, () => {
      console.log(`[server] listening on http://${tabletConfig.host}:${tabletConfig.port}`);
      networkAddresses().forEach((ip) => console.log(`[network] player http://${ip}:${tabletConfig.port}/player`)); resolve(server);
    });
  });
}
