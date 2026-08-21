import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { QueueItem } from "@trip-music/shared";
import { writeTone } from "./audio.js";

export type CacheEntry = { queueItemId:string; mediaKey:string; mediaType:"audio"|"video"; durationSeconds:number; coverKey?:string; updatedAt:string };
export class CacheStore {
  readonly mediaDir:string; readonly coverDir:string; readonly indexPath:string; private index=new Map<string,CacheEntry>();
  constructor(readonly dataDir:string){ this.mediaDir=path.join(dataDir,"media"); this.coverDir=path.join(dataDir,"covers"); this.indexPath=path.join(dataDir,"cache-index.json"); fs.mkdirSync(this.mediaDir,{recursive:true}); fs.mkdirSync(this.coverDir,{recursive:true}); this.load(); }
  private load(){ try { for(const e of JSON.parse(fs.readFileSync(this.indexPath,"utf8")) as CacheEntry[]) this.index.set(e.queueItemId,e); } catch {} }
  private persist(){ fs.writeFileSync(this.indexPath,JSON.stringify([...this.index.values()],null,2)); }
  seedDemo(items:QueueItem[]){ for(const [i,item] of items.entries()){ const key=`${item.id}.wav`; writeTone(this.mediaPath(key)!,4+i,330+i*90); this.put(item,key,"audio",item.localCoverKey??undefined); } }
  put(item:QueueItem,mediaKey:string,mediaType:"audio"|"video",coverKey?:string){ const existing=this.index.get(item.id); this.index.set(item.id,{queueItemId:item.id,mediaKey,mediaType,durationSeconds:item.durationSeconds,coverKey:coverKey??existing?.coverKey,updatedAt:new Date().toISOString()}); this.persist(); }
  putCover(itemId:string,coverKey:string){ const existing=this.index.get(itemId); if(existing) this.index.set(itemId,{...existing,coverKey,updatedAt:new Date().toISOString()}); else this.index.set(itemId,{queueItemId:itemId,mediaKey:"",mediaType:"audio",durationSeconds:0,coverKey,updatedAt:new Date().toISOString()}); this.persist(); }
  get(id:string){ return this.index.get(id); } all(){ return [...this.index.values()].filter(e=>e.mediaKey); }
  hasMedia(key:string){ const p=this.mediaPath(key); return Boolean(p&&fs.existsSync(p)); } hasCover(key:string){const p=this.coverPath(key);return Boolean(p&&fs.existsSync(p));}
  async remove(itemId:string){ const e=this.index.get(itemId); if(e?.mediaKey){const p=this.mediaPath(e.mediaKey);if(p) await fsp.rm(p,{force:true});} if(e?.coverKey){const p=this.coverPath(e.coverKey);if(p) await fsp.rm(p,{force:true});} this.index.delete(itemId);this.persist(); }
  mediaPath(key:string){return this.safePath(this.mediaDir,key);} coverPath(key:string){return this.safePath(this.coverDir,key);}
  private safePath(root:string,key:string){if(!/^[a-zA-Z0-9._-]+$/.test(key))return null;const p=path.resolve(root,key);return p.startsWith(path.resolve(root)+path.sep)?p:null;}
  ensureTestTone(){const key="test-tone.wav";const file=this.mediaPath(key)!;writeTone(file,5,523.25);return file;} count(){return this.all().length;}
}
