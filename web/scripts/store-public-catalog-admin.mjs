#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { renamePublicPublisher, setBundlePublic } from "../lib/publicCatalogAdmin.ts";

const {values,positionals}=parseArgs({allowPositionals:true,options:{
  help:{type:"boolean"},"key-id":{type:"string"},name:{type:"string"},
  bundle:{type:"string"},public:{type:"string"},
}});
const command=positionals[0];
if(values.help || !command){
  console.log(`Use the configured store-admin environment (DATABASE_URL), Node.js 24+:
  node scripts/store-public-catalog-admin.mjs migrate
  node scripts/store-public-catalog-admin.mjs publisher-name --key-id ed25519-d0ffc3c27628df9f --name "Old School GmbH"
  node scripts/store-public-catalog-admin.mjs bundle-public --bundle design-review --public true
Use --public false to hide a bundle. This CLI never publishes a package version or handles a payment.`);
  process.exit(0);
}
if(!["migrate","publisher-name","bundle-public"].includes(command)||positionals.length!==1)throw new Error("Unknown command");
if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL must be provided by the store-admin environment");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const client=await pool.connect();
try{
  let result;
  if(command==="migrate"){
    await client.query("BEGIN");
    try{
      await client.query(await readFile(new URL("../sql/migrations/20261006_public_catalog.sql",import.meta.url),"utf8"));
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    result={migrated:true,existingListingsPublished:false};
  }else if(command==="publisher-name"){
    result=await renamePublicPublisher(client,values["key-id"]??"",values.name??"");
  }else{
    if(!values.bundle||!["true","false"].includes(values.public))throw new Error("--bundle and --public true|false are required");
    result=await setBundlePublic(client,values.bundle,values.public==="true");
  }
  console.log(JSON.stringify(result));
}finally{client.release();await pool.end();}
