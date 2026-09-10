import {handleApi} from "@/lib/lumindaly/api";
import {runtime} from "@/lib/lumindaly/runtime";
export const dynamic="force-dynamic";
export async function GET(request:Request){return handleApi(request,await runtime());}
