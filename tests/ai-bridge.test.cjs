"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");
const path=require("node:path");
const {dispatch,declarations}=require("../integrations/bridge.cjs");
const root=path.join(__dirname,"..");
const request={operation:"trace",language:"javascript",code:"1+2;"};
test("capabilities come from local engine",async()=>{
 const x=await dispatch("iroh_capabilities",{});
 assert.equal(x.status,"OK"); assert.equal(x.executionEnabled,false); assert.match(x.engine.distSha256,/^[a-f0-9]{64}$/);
});
test("default denies execution and unknown argument escalation",async()=>{
 assert.equal((await dispatch("iroh_run",request)).status,"EXECUTION_DISABLED");
 assert.equal((await dispatch("iroh_run",{...request,trusted:true},{trusted:true})).status,"INVALID_REQUEST");
 assert.equal((await dispatch("iroh_run",{...request,code:"x".repeat(65537)},{trusted:true})).status,"INVALID_REQUEST");
 assert.equal((await dispatch("iroh_run",{...request,target:"python"},{trusted:true})).status,"INVALID_REQUEST");
});
test("trusted trace returns actual result and provenance",async()=>{
 const x=await dispatch("iroh_run",request,{trusted:true});assert.equal(x.status,"OK",JSON.stringify(x));assert.equal(x.result.result,3);assert.match(x.provenance.sourceSha256,/^[a-f0-9]{64}$/);
});
test("trusted scan returns real findings",async()=>{
 const x=await dispatch("iroh_run",{operation:"scan",language:"javascript",code:"let s=0; for(let i=0;i<150;i++) s+=i; s;"},{trusted:true});
 assert.equal(x.status,"OK",JSON.stringify(x));assert.ok(x.result.scan.findings.some(f=>f.code==="HOT_LOOP"));
});
test("trusted translation returns actual report",async()=>{
 const x=await dispatch("iroh_run",{operation:"translate",language:"javascript",target:"python",code:"function add(a,b){return a+b;}"},{trusted:true});
 assert.equal(x.status,"OK",JSON.stringify(x));assert.match(x.result.translation.code,/def add/);assert.ok(x.result.translation.report);
});
test("engine errors not labelled successful",async()=>{
 const x=await dispatch("iroh_run",{...request,code:"throw new Error('probe');"},{trusted:true});assert.equal(x.status,"ENGINE_ERROR");
});
test("platform declarations keep execution opt-in",()=>{
 for(const style of ["mcp","chat-completions","responses","gemini"]){
  assert.ok(!JSON.stringify(declarations(style)).includes("iroh_run"));assert.ok(JSON.stringify(declarations(style,true)).includes("iroh_run"));
 }
 const p=require("../integrations/platforms.json").platforms;assert.equal(p.length,10);assert.equal(new Set(p.map(x=>x.id)).size,10);
});
test("MCP legacy handshake, listing, denial, and trusted trace",()=>{
 const msgs=[{id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"test",version:"1"}}},{method:"notifications/initialized"},{id:2,method:"tools/list"},{id:3,method:"tools/call",params:{name:"iroh_run",arguments:request}}].map(m=>JSON.stringify({jsonrpc:"2.0",...m})).join("\n")+"\n";
 for(const trusted of [false,true]){
  const p=spawnSync(process.execPath,["integrations/mcp-stdio.cjs",...(trusted?["--trusted-code"]:[])],{cwd:root,input:msgs,encoding:"utf8",timeout:45000,maxBuffer:1024*1024});
  assert.equal(p.status,0,p.stderr);
  const out=p.stdout.trim().split("\n").map(JSON.parse);assert.equal(out.length,3);assert.equal(out[0].result.protocolVersion,"2025-11-25");assert.equal(out[1].result.tools.length,trusted?2:1);
  if(trusted)assert.equal(JSON.parse(out[2].result.content[0].text).result.result,3);else assert.equal(out[2].error.code,-32602);
 }
});
test("one-shot JSON rejects oversized input",()=>{
 const p=spawnSync(process.execPath,["integrations/bridge.cjs"],{cwd:root,input:"x".repeat(262145),encoding:"utf8",timeout:10000,maxBuffer:1024*1024});assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).status,"INVALID_REQUEST");
});
