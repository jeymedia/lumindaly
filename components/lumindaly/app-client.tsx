"use client";
import {Navigation,DashboardShell,PageHeading,Panel,Notice,LoadingState} from "./ui";
import {useApi} from "./hooks";
import {Scan,ScanResult} from "./scan";
import {Dashboard} from "./dashboard";
import {CaseScreen} from "./case";
import {Partner} from "./partner";
import {Admin} from "./admin";
import {ArrowRight} from "lucide-react";
export function AppClient({path,signInPath}:{path:string;signInPath:string}){
 const me=useApi("/api/me"),config=useApi("/api/config"),user=me.data?.user;
 const dashboard=path==="/dashboard"||path.startsWith("/case/")||path.startsWith("/admin")||path.startsWith("/partner")&&!!user;
 let content;
 if(path==="/scan")content=<Scan/>;
 else if(path.startsWith("/scan/result/"))content=<ScanResult id={path.split("/")[3]} user={user} config={config.data} signInPath={signInPath}/>;
 else if(path==="/dashboard")content=<Dashboard/>;
 else if(path.startsWith("/case/"))content=<CaseScreen id={path.split("/")[2]} tab={path.split("/")[3]??""} config={config.data}/>;
 else if(path.startsWith("/partner"))content=me.loading?<LoadingState/>:<Partner user={user} activate={path.endsWith("/activate")} signInPath={signInPath}/>;
 else if(path.startsWith("/admin"))content=me.loading?<LoadingState/>:<Admin path={path} user={user}/>;
 else content=<div className="page-container page-narrow"><PageHeading title="Keep your cases together." description="Sign in to save your scan, open a case, and return to your documents."/><Panel><a href={signInPath} target="_top" className="button primary">Continue with ChatGPT <ArrowRight size={17}/></a><p className="field-hint mt-4">Your Lumindaly account is created on your first sign-in. Your TikTok login is never requested.</p></Panel></div>;
 return dashboard?<DashboardShell path={path} user={user}>{content}</DashboardShell>:<><Navigation/><main>{content}</main></>;
}
