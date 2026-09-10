import {MAX_UPLOAD_BYTES} from "./config.ts";
export class HttpError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export async function sha256(value:string|ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",typeof value==="string"?new TextEncoder().encode(value):value))).map(x=>x.toString(16).padStart(2,"0")).join("");}
export function randomToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("");}
export function cookieValue(req:Request,key:string){return req.headers.get("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(key+"="))?.slice(key.length+1)??null;}
export function privateCookie(req:Request,key:string,value:string,maxAge:number){return key+"="+value+"; HttpOnly; SameSite=Lax; Path=/; Max-Age="+maxAge+(new URL(req.url).protocol==="https:"?"; Secure":"");}
export function assertSameOrigin(req:Request,configured?:string){
 const origin=req.headers.get("origin");
 if(!origin)throw new HttpError(403,"This request needs to come from the Lumindaly website.");
 const actual=new URL(req.url).origin;
 if(origin!==actual&&origin!==configured)throw new HttpError(403,"Cross-site request blocked.");
 const site=req.headers.get("sec-fetch-site");if(site==="cross-site")throw new HttpError(403,"Cross-site request blocked.");
}
export async function boundedBody(req:Request,max:number){const reader=req.body?.getReader();if(!reader)return new Uint8Array();let length=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw new HttpError(413,"The uploaded content is too large.");}chunks.push(value);}const body=new Uint8Array(length);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}return body;}
export async function readJson(req:Request,max=65536){try{return JSON.parse(new TextDecoder().decode(await boundedBody(req,max)));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Invalid JSON.");}}
export async function readForm(req:Request){const bytes=await boundedBody(req,MAX_UPLOAD_BYTES+100000);try{return await new Response(bytes,{headers:{"Content-Type":req.headers.get("content-type")??""}}).formData();}catch{throw new HttpError(400,"Invalid upload.");}}
export async function validateFile(file:File,allowPdf=true){
 if(!file.size||file.size>MAX_UPLOAD_BYTES)throw new HttpError(400,"Choose a non-empty file under 8 MB.");
 const bytes=await file.arrayBuffer();const b=new Uint8Array(bytes);
 const png=b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
 const jpg=b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255;
 const pdf=allowPdf&&new TextDecoder().decode(b.slice(0,5))==="%PDF-";
 const mime=png?"image/png":jpg?"image/jpeg":pdf?"application/pdf":null;
 if(!mime||file.type!==mime)throw new HttpError(400,"Use a valid PNG, JPG, or PDF matching its file type.");
 const extension=mime==="image/png"?"png":mime==="image/jpeg"?"jpg":"pdf";
 const filename=file.name.replace(/[^a-zA-Z0-9._ -]/g,"_").replace(/^\.+/,"").slice(0,120)||"document."+extension;
 return {bytes,mime,extension,filename,hash:await sha256(bytes)};
}
export function safeReturnPath(value:string){return value.startsWith("/")&&!value.startsWith("//")&&!value.includes("\\")?value:"/dashboard";}
export async function verifyStripeSignature(raw:string,header:string|null,secret:string,now=Date.now()){
 if(!secret||!header)return false;
 const parts=header.split(",");const t=parts.find(x=>x.startsWith("t="))?.slice(2);
 if(!t||!/^\d+$/.test(t)||Math.abs(now/1000-Number(t))>300)return false;
 const signatures=parts.filter(x=>x.startsWith("v1=")).map(x=>x.slice(3));
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(t+"."+raw)))).map(v=>v.toString(16).padStart(2,"0")).join("");
 return signatures.some(s=>{if(s.length!==digest.length)return false;let different=0;for(let i=0;i<s.length;i++)different|=s.charCodeAt(i)^digest.charCodeAt(i);return different===0;});
}
