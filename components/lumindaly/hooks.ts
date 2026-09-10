"use client";
import {useCallback,useEffect,useState} from "react";
export class ApiError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status;}}
export async function api(path:string,method="GET",body?:unknown){
 const form=body instanceof FormData;const r=await fetch(path,{method,credentials:"same-origin",cache:"no-store",...(body!==undefined?{body:form?body:JSON.stringify(body),headers:form?{}:{"Content-Type":"application/json"}}:{})});
 const data:any=await r.json().catch(()=>({error:"The service is temporarily unavailable. Please try again."}));if(!r.ok)throw new ApiError(data.error??"Something went wrong. Please try again.",r.status);return data;
}
export function useApi(path:string|null){
 const [data,setData]=useState<any>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
 const refresh=useCallback(()=>setVersion(v=>v+1),[]);
 useEffect(()=>{let active=true;if(!path){setLoading(false);return;}setLoading(true);api(path).then(d=>{if(active){setData(d);setError(null);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[path,version]);
 return {data,error,loading,refresh};
}
export function useAction(){
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState<string|null>(null);
 const run=async(fn:()=>Promise<any>,message?:string)=>{setBusy(true);setError(null);setSuccess(null);try{const result=await fn();if(message)setSuccess(message);return result;}catch(e){setError(e instanceof Error?e.message:"Something went wrong.");return null;}finally{setBusy(false);}};
 return {busy,error,success,run,setError};
}
