import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { QueueItem } from "@trip-music/shared";
import { writeTone } from "./audio.js";

export type CacheEntry = { queueItemId:string; mediaKey:string; mediaType:"audio"|"video"; durationSeconds:number; coverKey?:string; updatedAt:string };
export type CacheStats = { entries:number; mediaBytes:number; coverBytes:number; totalBytes:number };
export type CacheCleanupResult = CacheStats & { removedEntries:number; removedBytes:number; orphanFilesRemoved:number };

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

  private async fileBytes(file:string|null|undefined){ if(!file) return 0; try{return (await fsp.stat(file)).size;}catch{return 0;} }
  async stats():Promise<CacheStats>{
    let mediaBytes=0, coverBytes=0;
    for(const entry of this.index.values()){
      if(entry.mediaKey) mediaBytes += await this.fileBytes(this.mediaPath(entry.mediaKey));
      if(entry.coverKey) coverBytes += await this.fileBytes(this.coverPath(entry.coverKey));
    }
    return {entries:this.all().length,mediaBytes,coverBytes,totalBytes:mediaBytes+coverBytes};
  }

  /**
   * Keeps active/queued media protected, removes completed media after retention,
   * then enforces a hard disk cap by evicting the oldest unprotected entries.
   */
  async cleanup(options:{protectedItemIds?:Iterable<string>; retentionMs:number; maxBytes:number; nowMs?:number}):Promise<CacheCleanupResult>{
    const protectedIds=new Set(options.protectedItemIds??[]), nowMs=options.nowMs??Date.now();
    let removedEntries=0, removedBytes=0, orphanFilesRemoved=0;
    const removeEntry=async(id:string)=>{const entry=this.index.get(id); if(!entry)return; const before=(entry.mediaKey?await this.fileBytes(this.mediaPath(entry.mediaKey)):0)+(entry.coverKey?await this.fileBytes(this.coverPath(entry.coverKey)):0); await this.remove(id); removedEntries++; removedBytes+=before;};

    // Age-based cleanup for anything no longer needed by the live queue/player.
    for(const entry of [...this.index.values()].sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt))){
      if(protectedIds.has(entry.queueItemId)) continue;
      const updated=Date.parse(entry.updatedAt);
      if(Number.isFinite(updated) && nowMs-updated>=options.retentionMs) await removeEntry(entry.queueItemId);
    }

    // Hard cap: oldest non-active media goes first, regardless of retention age.
    let current=await this.stats();
    if(current.totalBytes>options.maxBytes){
      for(const entry of [...this.index.values()].sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt))){
        if(current.totalBytes<=options.maxBytes) break;
        if(protectedIds.has(entry.queueItemId)) continue;
        await removeEntry(entry.queueItemId);
        current=await this.stats();
      }
    }

    // Remove stale partial downloads and truly orphaned files to prevent silent growth.
    const indexed=new Set<string>();
    for(const e of this.index.values()){if(e.mediaKey)indexed.add(path.resolve(this.mediaDir,e.mediaKey));if(e.coverKey)indexed.add(path.resolve(this.coverDir,e.coverKey));}
    for(const root of [this.mediaDir,this.coverDir]){
      for(const name of await fsp.readdir(root).catch(()=>[] as string[])){
        const file=path.resolve(root,name); if(indexed.has(file)||name==="test-tone.wav")continue;
        try{const st=await fsp.stat(file); const stalePart=name.endsWith(".part")&&nowMs-st.mtimeMs>10*60*1000; const staleOrphan=!name.endsWith(".part")&&nowMs-st.mtimeMs>24*60*60*1000; if(stalePart||staleOrphan){removedBytes+=st.size;await fsp.rm(file,{force:true});orphanFilesRemoved++;}}catch{}
      }
    }
    const finalStats=await this.stats();
    return {...finalStats,removedEntries,removedBytes,orphanFilesRemoved};
  }
}
