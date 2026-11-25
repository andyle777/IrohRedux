"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { runLeg } = require("../lib/leg");
const { capabilities } = require("../lib/capabilities");
const pkg = require("../package.json");
const contract = require("./contract.json");
const MAX_INPUT = 256 * 1024;
const MAX_OUTPUT = 512 * 1024;
const MAX_CODE = 65536;
const digest = data => crypto.createHash("sha256").update(data).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function fail(status, message, extra = {}) {
  return { format: contract.format, status, message, ...extra };
}
function tools(trusted = false) {
  return contract.tools.filter(t => trusted || t.name !== "iroh_run");
}
function declarations(style, trusted = false) {
  const entries = tools(trusted);
  if (style === "mcp") return entries;
  if (style === "chat-completions") return entries.map(t => ({type:"function",function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
  if (style === "responses") return entries.map(t => ({type:"function",name:t.name,description:t.description,parameters:t.inputSchema,strict:false}));
  if (style === "gemini") return [{functionDeclarations:entries.map(t => ({name:t.name,description:t.description,parametersJsonSchema:t.inputSchema}))}];
  throw new Error("unsupported declaration style");
}
async function dispatch(name, args, {trusted = false} = {}) {
  if (!object(args)) return fail("INVALID_REQUEST","arguments must be an object");
  if (name === "iroh_capabilities") {
    if (Object.keys(args).length) return fail("INVALID_REQUEST","capabilities takes no arguments");
    return {format:contract.format,status:"OK",executionEnabled:trusted,engine:{version:pkg.version,distSha256:digest(fs.readFileSync(path.join(__dirname,"../dist/iroh-node.js")))},capabilities:capabilities()};
  }
  if (name !== "iroh_run") return fail("INVALID_REQUEST","unknown tool");
  if (!trusted) return fail("EXECUTION_DISABLED","Operator must explicitly enable trusted-code execution on the local host.");
  if (Object.keys(args).some(k => !["operation","language","code","target"].includes(k))) return fail("INVALID_REQUEST","unknown argument");
  const {operation,language,code,target} = args;
  const schema = contract.tools[1].inputSchema.properties;
  if (!schema.operation.enum.includes(operation) || !schema.language.enum.includes(language) || typeof code !== "string" || !code.length || Buffer.byteLength(code,"utf8") > MAX_CODE) return fail("INVALID_REQUEST","invalid operation, language or code size");
  if (operation === "translate" ? !schema.target.enum.includes(target) : target !== undefined) return fail("INVALID_REQUEST","target is required only for translation");
  const caps = capabilities().legs;
  if (!caps.some(x => x.leg === language && x.available)) return fail("UNAVAILABLE","requested language toolchain is not present");
  const provenance = {engineVersion:pkg.version,sourceSha256:digest(code),distSha256:digest(fs.readFileSync(path.join(__dirname,"../dist/iroh-node.js"))),operation,language,...(target ? {target}: {})};
  try {
    const out = await runLeg({operation,language,code,from:language,to:target,events:"ALL",timeoutMs:30000});
    const payload = {format:contract.format,status:out.error ? "ENGINE_ERROR":"OK",provenance,result:out};
    if (!out.error && operation !== "trace" && !out[operation === "analyze" ? "analysis" : operation === "translate" ? "translation" : "scan"]) return fail("ENGINE_ERROR","expected engine result missing",{provenance});
    if (Buffer.byteLength(JSON.stringify(payload),"utf8") > MAX_OUTPUT) return fail("OUTPUT_LIMIT","Execution completed but result exceeds the bridge output budget; no partial result supplied.",{provenance});
    return payload;
  } catch {
    return fail("ENGINE_ERROR","local engine could not complete the request",{provenance});
  }
}
async function readOne(stream) {
  let chunks = [], size = 0;
  for await (const c of stream) {
    size += c.length;
    if (size > MAX_INPUT) throw new Error("input exceeds 256 KiB");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function main() {
  const args=process.argv.slice(2);
  const trusted=args.includes("--trusted-code");
  const rest=args.filter(x=>x!=="--trusted-code");
  if (rest[0]==="--describe" && rest.length===2) {
    console.log(JSON.stringify(declarations(rest[1],trusted),null,2)); return;
  }
  if (rest.length) throw new Error("usage: node integrations/bridge.cjs [--trusted-code] [--describe mcp|chat-completions|responses|gemini]");
  const request=await readOne(process.stdin);
  const result=object(request) && Object.keys(request).every(k=>["name","arguments"].includes(k)) ? await dispatch(request.name,request.arguments,{trusted}) : fail("INVALID_REQUEST","expected name and arguments");
  console.log(JSON.stringify(result));
  if (result.status!=="OK") process.exitCode=1;
}
module.exports={dispatch,declarations,tools,MAX_INPUT,fail,object};
if (require.main===module) main().catch(e=>{console.log(JSON.stringify(fail("INVALID_REQUEST",e.message)));process.exitCode=1;});
