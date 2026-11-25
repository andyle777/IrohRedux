"use strict";
// Local newline-framed MCP subset, using legacy initialize lifecycle.
// No network listener, resources, sampling, or remote authentication.
const {dispatch,tools,MAX_INPUT,object}=require("./bridge.cjs");
const trusted=process.argv.slice(2).length===1 && process.argv[2]==="--trusted-code";
if(process.argv.length>2 && !trusted){process.stderr.write("Invalid MCP arguments\n");process.exit(2);}
const versions=["2025-11-25","2025-06-18","2025-03-26","2024-11-05"];
let initialized=false, ready=false;
const send = obj => process.stdout.write(JSON.stringify(obj)+"\n");
const error = (id,code,message) => send({jsonrpc:"2.0",id:id??null,error:{code,message}});
async function line(raw) {
  let msg;
  try{msg=JSON.parse(raw.toString("utf8"));}catch{error(null,-32700,"Parse error");return;}
  if(!object(msg)||msg.jsonrpc!=="2.0"||typeof msg.method!=="string"){error(null,-32600,"Invalid request");return;}
  const hasId=Object.prototype.hasOwnProperty.call(msg,"id");
  if(hasId && typeof msg.id!=="string" && !Number.isSafeInteger(msg.id)){error(null,-32600,"Invalid id");return;}
  if(!hasId){
    if(msg.method==="notifications/initialized"&&initialized) ready=true;
    return;
  }
  const id=msg.id, p=msg.params;
  const reply=result=>send({jsonrpc:"2.0",id,result});
  if(msg.method==="initialize"){
    if(initialized||!object(p)||typeof p.protocolVersion!=="string"){error(id,-32602,"Invalid initialization");return;}
    initialized=true;
    return reply({protocolVersion:versions.includes(p.protocolVersion)?p.protocolVersion:versions[0],capabilities:{tools:{}},serverInfo:{name:"irohredux",version:require("../package.json").version}});
  }
  if(msg.method==="ping") return reply({});
  if(!ready){error(id,-32002,"Initialize first");return;}
  if(msg.method==="tools/list") return reply({tools:tools(trusted)});
  if(msg.method==="tools/call"){
    if(!object(p)||typeof p.name!=="string"){error(id,-32602,"Invalid tool call");return;}
    if(!tools(trusted).some(t=>t.name===p.name)){error(id,-32602,"Unknown or disabled tool");return;}
    let out;
    try{out=await dispatch(p.name,p.arguments??{},{trusted});}catch{out={status:"ENGINE_ERROR",message:"Local operation failed"};}
    return reply({content:[{type:"text",text:JSON.stringify(out)}],isError:out.status!=="OK"});
  }
  error(id,-32601,"Method not found");
}
async function main(){
  let pending=Buffer.alloc(0);
  for await(const chunk of process.stdin){
    let start=0;
    for(let i=0;i<chunk.length;i++){
      if(chunk[i]!==10) continue;
      const piece=chunk.subarray(start,i);
      if(pending.length+piece.length>MAX_INPUT) throw Error("frame exceeds input limit");
      const frame=Buffer.concat([pending,piece]); pending=Buffer.alloc(0); start=i+1;
      if(frame.length) await line(frame);
    }
    const tail=chunk.subarray(start);
    if(pending.length+tail.length>MAX_INPUT) throw Error("frame exceeds input limit");
    pending=Buffer.concat([pending,tail]);
  }
  if(pending.length) throw Error("unterminated frame");
}
main().catch(e=>{process.stderr.write(e.message+"\n");process.exitCode=1;});
