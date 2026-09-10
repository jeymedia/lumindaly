import {env} from "cloudflare:workers";
import {getChatGPTUser} from "@/app/chatgpt-auth";
import type {Services,RuntimeConfig} from "./contracts.ts";
export async function runtime():Promise<Services>{
 if(!env.DB||!env.BUCKET)throw new Error("Storage unavailable");
 const u=await getChatGPTUser();
 return {db:env.DB,bucket:env.BUCKET,auth:u?{id:u.userId,email:u.email,displayName:u.displayName}:null,config:env as RuntimeConfig};
}
