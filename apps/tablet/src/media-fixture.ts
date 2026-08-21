import http from "node:http";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

type Encoder = { encodeBuffer(samples: Int16Array): Int8Array; flush(): Int8Array };
type EncoderClass = new (channels: number, sampleRate: number, kbps: number) => Encoder;
const require = createRequire(import.meta.url), context: Record<string, unknown> = {};
vm.runInNewContext(`${fs.readFileSync(require.resolve("lamejs/lame.all.js"), "utf8")}\nencoderClass = lamejs.Mp3Encoder;`, context);
const Mp3Encoder = context.encoderClass as EncoderClass;

const coverJpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=", "base64");

export function synthesizeMp3(frequency: number, seconds = 2) {
  const sampleRate = 44_100, samples = new Int16Array(sampleRate * seconds);
  for (let index = 0; index < samples.length; index++) {
    const envelope = Math.min(1, index / 2_000, (samples.length - index) / 2_000);
    samples[index] = Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * 5_000 * envelope);
  }
  const encoder = new Mp3Encoder(1, sampleRate, 128), chunks: Buffer[] = [];
  for (let offset = 0; offset < samples.length; offset += 1_152) {
    const encoded = encoder.encodeBuffer(samples.subarray(offset, offset + 1_152));
    if (encoded.length) chunks.push(Buffer.from(encoded));
  }
  const tail = encoder.flush(); if (tail.length) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

export function assertLocalMediaFixtureAllowed(env = process.env) {
  if (env.NODE_ENV === "production" || env.ALLOW_LOCAL_MEDIA_TEST !== "true") throw new Error("Local media fixture requires ALLOW_LOCAL_MEDIA_TEST=true and NODE_ENV must not be production");
}

export async function startLocalMediaFixture(options: { port?: number; host?: string } = {}) {
  assertLocalMediaFixtureAllowed();
  const tracks = new Map([["a.mp3", synthesizeMp3(440)], ["b.mp3", synthesizeMp3(554)], ["c.mp3", synthesizeMp3(659)]]);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://fixture").pathname;
    const track = tracks.get(pathname.slice(1));
    if (track) { res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": track.length, "Cache-Control": "no-store" }); if (req.method === "HEAD") return res.end(); return res.end(track); }
    if (/^\/covers\/[abc]\.jpg$/.test(pathname)) { res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": coverJpeg.length, "Cache-Control": "no-store" }); if (req.method === "HEAD") return res.end(); return res.end(coverJpeg); }
    if (pathname === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, tracks: 3 })); }
    res.writeHead(404); return res.end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture did not bind a TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl, trackUrls: ["a", "b", "c"].map((id) => `${baseUrl}/${id}.mp3`), coverUrls: ["a", "b", "c"].map((id) => `${baseUrl}/covers/${id}.jpg`), close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
