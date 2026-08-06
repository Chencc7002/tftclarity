import { randomUUID } from "node:crypto";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { resolveStorageConfig } from "../src/storage/config.js";
import { createRedisClient, RedisStore } from "../src/storage/redis-store.js";

loadLocalEnvironment();const config=resolveStorageConfig({ephemeralStore:"redis"});const client=await createRedisClient({url:config.redisUrl,connectTimeoutMs:config.redisConnectTimeoutMs});const store=new RedisStore({client,prefix:config.redisPrefix});const id=randomUUID();
try{await store.setSessionState(id,{ok:true},{seasonContextId:"set17-live",ttlMs:5000});if((await store.getSessionState(id,{seasonContextId:"set17-live"}))?.value?.ok!==true)throw new Error("Redis session contract failed");const rate=await store.incrementRateLimit(`smoke:${id}`,1,5000);if(!rate.allowed)throw new Error("Redis atomic limit contract failed");console.log(JSON.stringify(await store.healthCheck()));}finally{await store.deleteSessionState(id,{seasonContextId:"set17-live"});await store.close();}
