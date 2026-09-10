"use client";
import Link from "next/link";
import {useState,type ReactNode,type ComponentProps} from "react";
import {ScanLine,LayoutDashboard,Handshake,ShieldCheck,ArrowUpRight,LogOut,UploadCloud,FileText,AlertTriangle,Info,CheckCircle2,LoaderCircle,FolderOpen,LifeBuoy} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {NativeSelect,NativeSelectOption} from "@/components/ui/native-select";
import {Card} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Alert} from "@/components/ui/alert";
import {Progress} from "@/components/ui/progress";
import {Empty,EmptyTitle,EmptyDescription} from "@/components/ui/empty";
import {Sidebar,SidebarProvider,SidebarContent,SidebarHeader,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarGroup,SidebarTrigger,SidebarInset} from "@/components/ui/sidebar";
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";
export {Button,Input,Progress};
export {Textarea} from "@/components/ui/textarea";
export function Select({options,...props}:Omit<ComponentProps<"select">,"size">&{options:Array<{value:string;label:string}>}){
 return <NativeSelect {...props} className={"!h-11 !text-sm "+(props.className??"")}>{options.map(o=><NativeSelectOption value={o.value} key={o.value}>{o.label}</NativeSelectOption>)}</NativeSelect>;
}
export function Panel({children,className=""}:{children:ReactNode;className?:string}){return <Card className={"panel block shadow-none "+className}>{children}</Card>;}
export function Notice({children,kind="info"}:{children:ReactNode;kind?:"info"|"error"|"warning"|"success"}){
 const Icon=kind==="error"||kind==="warning"?AlertTriangle:kind==="success"?CheckCircle2:Info;
 return <Alert className={"alert-block "+kind}><Icon size={18}/><div>{children}</div></Alert>;
}
export function StatusBadge({status}:{status:string}){
 const positive=["paid","approved","ready","verified"].includes(status);
 const review=["human_review","manual_review","needs_review","requested","pending"].includes(status);
 return <Badge variant="outline" className={"rounded-md border px-2.5 py-1 text-xs font-medium "+(positive?"border-emerald-200 bg-emerald-50 text-emerald-800":review?"border-amber-200 bg-amber-50 text-amber-800":"border-slate-200 bg-slate-50 text-slate-600")}>{status.replace(/_/g," ").replace(/^./,c=>c.toUpperCase())}</Badge>;
}
export function Field({label,hint,children,full=false,htmlFor}:{label:string;hint?:string;children:ReactNode;full?:boolean;htmlFor?:string}){
 return <div className={full?"form-full":""}><label className="field-label" htmlFor={htmlFor}>{label}</label>{children}{hint&&<p className="field-hint">{hint}</p>}</div>;
}
export function FileUpload({name="file",label="Choose a file or drop it here"}:{name?:string;label?:string}){
 const [filename,setFilename]=useState("");
 return <label className="upload-box"><UploadCloud size={29}/><strong>{filename||label}</strong><p>JPG, PNG, or PDF · Up to 8 MB · Private storage</p><input name={name} type="file" aria-label={label} accept="image/jpeg,image/png,application/pdf" onChange={e=>setFilename(e.target.files?.[0]?.name??"")}/></label>;
}
export function StatCard({label,value,caption,icon:Icon=LayoutDashboard}:{label:string;value:string|number;caption?:string;icon?:typeof LayoutDashboard}){
 return <div className="stat-card"><div className="stat-top"><span>{label}</span><Icon size={17}/></div><div className="stat-value money">{value}</div>{caption&&<p className="stat-caption">{caption}</p>}</div>;
}
export function LoadingState(){return <div className="page-loader" role="status"><LoaderCircle size={22} className="animate-spin"/> Loading your workspace…</div>;}
export function EmptyState({title,description,children}:{title:string;description:string;children?:ReactNode}){
 return <Empty className="empty-state border-0"><div className="case-icon"><FolderOpen size={26}/></div><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription>{children}</Empty>;
}
export function Brand(){return <Link href="/" className="brand"><span className="brand-mark"><ScanLine size={20}/></span>Lumindaly<span className="brand-period">.</span></Link>;}
export function Navigation(){return <header className="site-header"><Brand/><nav className="header-links"><Link href="/scan">Free scan</Link><Link href="/partner">For partners</Link></nav><div className="header-actions"><Link href="/dashboard" className="button secondary small">My cases <ArrowUpRight size={15}/></Link></div></header>;}
export function DashboardShell({children,path,user}:{children:ReactNode;path:string;user:any}){
 const links=[{url:"/dashboard",title:"My cases",icon:LayoutDashboard},{url:"/scan",title:"New free scan",icon:ScanLine},{url:"/partner",title:"Partner dashboard",icon:Handshake},...(user?.is_admin?[{url:"/admin",title:"Administration",icon:ShieldCheck}]:[])];
 return <SidebarProvider><Sidebar><SidebarHeader className="px-5 py-7"><Brand/></SidebarHeader><SidebarContent><SidebarGroup className="px-3"><div className="px-3 pb-3 pt-2 text-xs font-medium tracking-wider text-slate-400">WORKSPACE</div><SidebarMenu>{links.map(l=><SidebarMenuItem key={l.url}><SidebarMenuButton asChild isActive={path===l.url||l.url==="/dashboard"&&path.startsWith("/case/")||l.url==="/admin"&&path.startsWith("/admin")} className="h-11 px-3"><Link href={l.url}><l.icon size={18}/><span>{l.title}</span></Link></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup><div className="mx-5 mt-auto rounded-lg border border-slate-200 bg-slate-50 p-4"><ShieldCheck size={21} className="mb-3 text-blue-600"/><p className="text-sm font-medium text-slate-700">Your facts. Your case.</p><p className="mt-2 text-xs leading-relaxed text-slate-500">Keep originals and submit only information you can support.</p></div></SidebarContent><SidebarFooter className="border-t border-slate-100 p-5"><p className="truncate text-sm font-medium text-slate-700">{user?.email??"Your account"}</p><a href="/signout-with-chatgpt?return_to=%2F" target="_top" className="mt-1 flex items-center gap-2 text-xs text-slate-500"><LogOut size={14}/>Sign out</a></SidebarFooter></Sidebar><SidebarInset><header className="flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 sm:px-8"><div className="flex items-center gap-3"><SidebarTrigger/><span className="text-sm text-slate-500">Your Lumindaly workspace</span></div><Link href="/scan" className="button primary small"><ScanLine size={15}/>New scan</Link></header><main className="min-w-0">{children}</main></SidebarInset></SidebarProvider>;
}
export function PageHeading({eyebrow,title,description,children}:{eyebrow?:string;title:string;description?:string;children?:ReactNode}){
 return <div className="page-heading"><div>{eyebrow&&<div className="eyebrow mb-3">{eyebrow}</div>}<h1 className="page-title">{title}</h1>{description&&<p className="page-subtitle">{description}</p>}</div>{children}</div>;
}
export function Modal({open,title,description,onClose,onConfirm,children,busy=false}:{open:boolean;title:string;description:string;onClose:()=>void;onConfirm:()=>void;children?:ReactNode;busy?:boolean}){
 return <Dialog open={open} onOpenChange={v=>{if(!v)onClose();}}><DialogContent><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription>{children}<DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={onConfirm}>{busy?"Saving…":"Confirm"}</Button></DialogFooter></DialogContent></Dialog>;
}
