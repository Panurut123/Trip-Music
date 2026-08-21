import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { PreparedMedia, QueueItem, TrackMetadata } from "@trip-music/shared";
import { parseIsoDuration, validateSourceUrl } from "@trip-music/shared";
import { writeTone } from "./audio.js";
import type { CacheStore } from "./cache.js";
import { isLocalMediaTestEnabled, tabletConfig } from "./config.js";

export interface MetadataResolver { canHandle(url:string):boolean; resolve(url:string):Promise<TrackMetadata>; }
export interface MediaProvider { canHandle(url:string):boolean; prepareAudio(item:QueueItem,cache:CacheStore):Promise<PreparedMedia>; prepareVideo(item:QueueItem,cache:CacheStore):Promise<PreparedMedia>; }
const execFileAsync = promisify(execFile);
export async function probeDurationSeconds(file: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { timeout: 10_000 });
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
  } catch { return null; }
}
export const extractYouTubeId = (raw: string): string | null => {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const normalized = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
    const u = new URL(normalized);
    const h = u.hostname.replace(/^(www\.|m\.)/, "");
    if (h === "youtu.be") {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      return seg ? seg.split("?")[0] : null;
    }
    if (["youtube.com", "music.youtube.com"].includes(h)) {
      if (u.pathname === "/watch" || u.pathname.startsWith("/watch")) {
        const v = u.searchParams.get("v");
        if (v) return v;
      }
      const m = /^\/(shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
      if (m?.[2]) return m[2];
      const vParam = u.searchParams.get("v");
      if (vParam) return vParam;
    }
    const generalMatch = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?v=|watch\?.+&v=))([\w-]{11})/.exec(raw);
    if (generalMatch?.[1]) return generalMatch[1];
  } catch {}
  return null;
};

export class YouTubeMetadataResolver implements MetadataResolver {
  canHandle(url: string) { return Boolean(extractYouTubeId(url)); }
  async resolve(url: string): Promise<TrackMetadata> {
    const id = extractYouTubeId(url);
    if (!id) throw new Error("Invalid YouTube URL");

    // 1. If API key is available, use YouTube Data API v3
    if (tabletConfig.youtubeApiKey) {
      try {
        const u = new URL("https://www.googleapis.com/youtube/v3/videos");
        u.searchParams.set("part", "snippet,contentDetails,status,liveStreamingDetails");
        u.searchParams.set("id", id);
        u.searchParams.set("key", tabletConfig.youtubeApiKey);
        const r = await fetch(u, { signal: AbortSignal.timeout(tabletConfig.downloadTimeoutMs) });
        if (r.ok) {
          const row = (await r.json() as {
            items?: Array<{
              snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url: string }> };
              contentDetails?: { duration?: string; regionRestriction?: { allowed?: string[]; blocked?: string[] } };
              status?: { embeddable?: boolean; privacyStatus?: string; uploadStatus?: string };
              liveStreamingDetails?: unknown;
            }>;
          }).items?.[0];
          if (!row) throw new Error("youtube_unavailable");
          if (row?.snippet) {
            if (row.liveStreamingDetails) throw new Error("youtube_livestream_unsupported");
            if (row.status?.privacyStatus === "private" || row.status?.uploadStatus === "deleted" || row.status?.uploadStatus === "rejected") throw new Error("youtube_unavailable");
            if (row.status && row.status.embeddable === false) throw new Error("youtube_unembeddable");
            const t = row.snippet.thumbnails ?? {};
            const thumbnail = ["maxres", "standard", "high", "medium", "default"].map((k) => t[k]?.url).find(Boolean) ?? null;
            return {
              title: row.snippet.title ?? "YouTube video",
              artist: row.snippet.channelTitle ?? "YouTube creator",
              durationSeconds: parseIsoDuration(row.contentDetails?.duration),
              thumbnailUrl: thumbnail ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              coverUrlOriginal: thumbnail ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              sourceUrl: url,
              sourceKey: `youtube:${id}`,
              sourceProvider: "youtube",
            };
          }
        }
      } catch (err) {
        if (err instanceof Error && /^youtube_(unembeddable|unavailable|livestream_unsupported)$/.test(err.message)) throw err;
      }
    }

    // 2. Public fallback via YouTube official oEmbed API + watch page duration probe
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(tabletConfig.downloadTimeoutMs) });
      if (res.ok) {
        const data = await res.json() as { title?: string; author_name?: string; thumbnail_url?: string };
        const thumbnail = data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

        let durationSeconds = 0;
        try {
          const pageRes = await fetch(`https://www.youtube.com/watch?v=${id}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            signal: AbortSignal.timeout(tabletConfig.downloadTimeoutMs),
          });
          if (pageRes.ok) {
            const html = await pageRes.text();
            const metaDuration = /<meta\s+itemprop="duration"\s+content="([^"]+)"/i.exec(html)?.[1] ||
                                 /<meta\s+content="([^"]+)"\s+itemprop="duration"/i.exec(html)?.[1];
            if (metaDuration) {
              durationSeconds = parseIsoDuration(metaDuration);
            } else {
              const approxMatch = /"approxDurationMs":"(\d+)"/.exec(html);
              if (approxMatch) durationSeconds = Math.round(Number(approxMatch[1]) / 1000);
              else {
                const lengthMatch = /"lengthSeconds":"(\d+)"/.exec(html);
                if (lengthMatch) durationSeconds = Number(lengthMatch[1]);
              }
            }
          }
        } catch {}

        return {
          title: data.title ?? "YouTube video",
          artist: data.author_name ?? "YouTube creator",
          durationSeconds,
          thumbnailUrl: thumbnail,
          coverUrlOriginal: thumbnail,
          sourceUrl: url,
          sourceKey: `youtube:${id}`,
          sourceProvider: "youtube",
        };
      }
    } catch {}

    // 3. Resilient final fallback
    return {
      title: `YouTube Video`,
      artist: `YouTube (${id})`,
      durationSeconds: 0,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      coverUrlOriginal: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      sourceUrl: url,
      sourceKey: `youtube:${id}`,
      sourceProvider: "youtube",
    };
  }
}




export class YouTubeEmbedProvider implements MediaProvider {
  canHandle(url: string) { return Boolean(extractYouTubeId(url)); }
  async prepareAudio(item: QueueItem, _cache: CacheStore): Promise<PreparedMedia> {
    const id = extractYouTubeId(item.sourceUrl);
    if (!id) throw new Error("Invalid YouTube URL");
    return { playbackType: "embed", embedProvider: "youtube", embedId: id, mediaType: "video" };
  }
  async prepareVideo(item: QueueItem, cache: CacheStore): Promise<PreparedMedia> {
    return this.prepareAudio(item, cache);
  }
}

export class SpotifyMetadataResolver implements MetadataResolver {
  canHandle(url:string){try{const h=new URL(url).hostname.toLowerCase();return h==="open.spotify.com"||h==="spotify.link";}catch{return false;}}
  async resolve(url:string):Promise<TrackMetadata>{let canonical=url;let id:string|undefined;try{const probe=await fetch(url,{method:"HEAD",redirect:"follow",signal:AbortSignal.timeout(tabletConfig.downloadTimeoutMs)});canonical=probe.url||url;id=/open\.spotify\.com\/track\/([A-Za-z0-9]+)/.exec(canonical)?.[1];}catch{}const embed=await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`,{signal:AbortSignal.timeout(tabletConfig.downloadTimeoutMs)});if(!embed.ok)throw new Error(`Spotify oEmbed failed (${embed.status})`);const o=await embed.json() as {title?:string;thumbnail_url?:string};let title=o.title??"Spotify track",artist="Spotify" as string,duration=0,cover=o.thumbnail_url??null;if(id&&tabletConfig.spotifyClientId&&tabletConfig.spotifyClientSecret){const token=await fetch("https://accounts.spotify.com/api/token",{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${tabletConfig.spotifyClientId}:${tabletConfig.spotifyClientSecret}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials",signal:AbortSignal.timeout(tabletConfig.downloadTimeoutMs)});if(token.ok){const access=(await token.json() as {access_token:string}).access_token;const track=await fetch(`https://api.spotify.com/v1/tracks/${id}`,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(tabletConfig.downloadTimeoutMs)});if(track.ok){const x=await track.json() as {name?:string;artists?:Array<{name:string}>;duration_ms?:number;album?:{images?:Array<{url:string}>}};title=x.name??title;artist=x.artists?.map(a=>a.name).join(", ")||artist;duration=Math.round((x.duration_ms??0)/1000);cover=x.album?.images?.[0]?.url??cover;}}}return {title,artist,durationSeconds:duration,thumbnailUrl:cover,coverUrlOriginal:cover,sourceUrl:canonical,sourceKey:id?`spotify:${id}`:`spotify:${canonical}`,sourceProvider:"spotify"};}
}
const extFor=(contentType:string,url:string)=>{const mime=contentType.split(";")[0].toLowerCase();const byMime:Record<string,string>={"audio/mpeg":".mp3","audio/mp4":".m4a","audio/x-m4a":".m4a","audio/wav":".wav","audio/x-wav":".wav","audio/webm":".webm","video/mp4":".mp4","video/webm":".webm","image/jpeg":".jpg","image/png":".png","image/webp":".webp"};return byMime[mime]??path.extname(new URL(url).pathname).toLowerCase();};
async function streamDownload(response:Response,file:string,max:number){const len=Number(response.headers.get("content-length")??0);if(len&&len>max)throw new Error("Download exceeds configured size limit");if(!response.body)throw new Error("Response had no body");let seen=0;const check=new TransformStream({transform(chunk,controller){seen+=chunk.byteLength;if(seen>max)throw new Error("Download exceeds configured size limit");controller.enqueue(chunk);}});await pipeline(Readable.fromWeb(response.body.pipeThrough(check) as never),fs.createWriteStream(file,{flags:"wx"}));}
export async function cacheCover(item:QueueItem,cache:CacheStore):Promise<string|null>{const url=item.coverUrlOriginal; if(!url)return null;const safe=validateSourceUrl(url,{allowLocalhost:isLocalMediaTestEnabled()});if(!safe.ok)return null;const part=cache.coverPath(`${item.id}.part`)!;try{const r=await fetch(safe.normalized,{signal:AbortSignal.timeout(tabletConfig.downloadTimeoutMs)});const mime=r.headers.get("content-type")?.split(";")[0].toLowerCase()??"";if(!r.ok||!new Set(["image/jpeg","image/png","image/webp"]).has(mime))throw new Error("Unsupported cover MIME type");await fsp.rm(part,{force:true});await streamDownload(r,part,tabletConfig.maxCoverBytes);const key=`${item.id}${extFor(mime,url)}`;await fsp.rename(part,cache.coverPath(key)!);cache.putCover(item.id,key);return key;}catch{await fsp.rm(part,{force:true});return null;}}
export class MockProvider implements MetadataResolver,MediaProvider { canHandle(url:string){return url.startsWith("mock:");} async resolve(url:string){return {title:url.replace(/^mock:/,"Mock track "),artist:"Trip Music Test Lab",durationSeconds:180,sourceUrl:url,sourceKey:url,sourceProvider:"mock"} as TrackMetadata;} async prepareAudio(item:QueueItem,cache:CacheStore){const key=`${item.id}.wav`;writeTone(cache.mediaPath(key)!,3,440);return {playbackType:"local",mediaKey:key,mediaType:"audio"} as PreparedMedia;} async prepareVideo(item:QueueItem,cache:CacheStore){return this.prepareAudio(item,cache);} }
export class DirectMediaProvider implements MetadataResolver,MediaProvider {
  private allowed=new Set((process.env.MEDIA_ALLOWED_HOSTS??"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean));
  private localTestEnabled:boolean;
  constructor(options:{allowLocalMediaTest?:boolean}={}){this.localTestEnabled=process.env.NODE_ENV!=="production"&&(options.allowLocalMediaTest??isLocalMediaTestEnabled());}
  private isLocalTestHost(host:string){return this.localTestEnabled&&["localhost","127.0.0.1","::1"].includes(host);}
  canHandle(url:string){try{const u=new URL(url);const host=u.hostname.toLowerCase();return ["http:","https:"].includes(u.protocol)&&(this.allowed.has(host)||this.isLocalTestHost(host));}catch{return false;}}
  async resolve(url:string):Promise<TrackMetadata>{if(!this.canHandle(url))throw new Error("Source is not an allowed direct media URL");const title=decodeURIComponent(path.basename(new URL(url).pathname)||"Direct media");try{await fetch(url,{method:"HEAD",signal:AbortSignal.timeout(tabletConfig.downloadTimeoutMs)});}catch{}return {title,artist:"Unknown artist",durationSeconds:tabletConfig.unknownDurationEstimateSeconds,sourceUrl:url,sourceKey:`direct:${url}`,sourceProvider:"direct",thumbnailUrl:null,coverUrlOriginal:null};}
  private async download(item:QueueItem,cache:CacheStore,target:"audio"|"video"){if(!this.canHandle(item.sourceUrl))throw new Error("Source is not an allowed direct media URL");const safe=validateSourceUrl(item.sourceUrl,{allowLocalhost:this.localTestEnabled});if(!safe.ok)throw new Error(safe.reason);const r=await fetch(safe.normalized,{signal:AbortSignal.timeout(tabletConfig.downloadTimeoutMs)});const type=(r.headers.get("content-type")??"").split(";")[0].toLowerCase();const audio=new Set(["audio/mpeg","audio/mp4","audio/x-m4a","audio/wav","audio/x-wav","audio/webm"]),video=new Set(["video/mp4","video/webm"]);if(!r.ok||!(target==="audio"?audio:video).has(type))throw new Error("Unsupported direct media MIME type");const ext=extFor(type,item.sourceUrl);if(!ext)throw new Error("Unknown direct media extension");const key=`${item.id}${ext}`,final=cache.mediaPath(key)!,part=cache.mediaPath(`${item.id}.part`)!;try{await fsp.rm(part,{force:true});await streamDownload(r,part,target==="audio"?tabletConfig.maxAudioBytes:tabletConfig.maxVideoBytes);await fsp.rename(part,final);const probed=await probeDurationSeconds(final);if(probed&&(item.durationSeconds<=0||item.durationSeconds===tabletConfig.unknownDurationEstimateSeconds))item.durationSeconds=probed;return {playbackType:"local",mediaKey:key,mediaType:target} as PreparedMedia;}catch(e){await fsp.rm(part,{force:true});throw e;}}
  prepareAudio(item:QueueItem,cache:CacheStore){return this.download(item,cache,"audio");} prepareVideo(item:QueueItem,cache:CacheStore){return this.download(item,cache,"video");}
}
