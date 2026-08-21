import "dotenv/config";
import { startLocalMediaFixture } from "./media-fixture.js";

const fixture = await startLocalMediaFixture({ port: Number(process.env.LOCAL_MEDIA_FIXTURE_PORT ?? 3400) });
console.log(`[fixture] three synthetic MP3 tracks at ${fixture.baseUrl}/a.mp3, /b.mp3, /c.mp3`);
const close = async () => { await fixture.close(); process.exit(0); };
process.on("SIGINT", () => void close()); process.on("SIGTERM", () => void close());
