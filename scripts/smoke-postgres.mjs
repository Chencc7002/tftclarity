import { randomUUID } from "node:crypto";
import { loadLocalEnvironment } from "../src/config/load-env.js";
import { resolveStorageConfig } from "../src/storage/config.js";
import { createPostgresPool } from "../src/storage/postgres/client.js";
import { PostgresStore } from "../src/storage/postgres/postgres-store.js";

loadLocalEnvironment();
const pool=createPostgresPool(resolveStorageConfig({persistentStore:"postgres"}));const store=new PostgresStore({pool});const key=`smoke:${randomUUID()}`;
try{await store.setUserPreference(key,{ok:true});const value=await store.getUserPreference(key);if(value?.value?.ok!==true)throw new Error("PostgreSQL preference contract failed");await store.deleteUserPreference(key);console.log(JSON.stringify(await store.healthCheck()));}finally{await pool.end();}
