import {handleApi} from "@/lib/lumindaly/api";
import {runtime} from "@/lib/lumindaly/runtime";
export const dynamic="force-dynamic";
async function handle(request:Request){
 try{return await handleApi(request,await runtime());}
 catch{return Response.json({error:"The case workspace is temporarily unavailable. Please try again."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
export {handle as GET,handle as POST,handle as PATCH,handle as DELETE};
