import {notFound} from "next/navigation";
import {requireChatGPTUser,chatGPTSignInPath} from "@/app/chatgpt-auth";
import {AppClient} from "@/components/lumindaly/app-client";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{path:string[]}>}){
 const {path:segments}=await params;const path="/"+segments.join("/");
 if(!/^\/(scan(?:\/result\/[^/]+)?|dashboard|case\/[^/]+(?:\/(evidence|appeal|outcome))?|partner(?:\/activate)?|admin(?:\/(cases(?:\/[^/]+)?|rules|affiliates|commissions))?|login|signup)$/.test(path))notFound();
 return <Screen path={path}/>;
}
async function Screen({path}:{path:string}){
 const protectedPath=path==="/dashboard"||path.startsWith("/case/")||path.startsWith("/admin")||path==="/partner/activate";
 if(protectedPath)await requireChatGPTUser(path);
 return <AppClient key={path} path={path} signInPath={chatGPTSignInPath(path==="/login"||path==="/signup"?"/dashboard":path)}/>;
}
