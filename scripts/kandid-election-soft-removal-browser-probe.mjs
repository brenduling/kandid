// One fresh Microsoft Edge instance, separate from the failing Chrome session.
// Availability probe only: about:blank, no Supabase or application requests.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const profile=mkdtempSync(join(tmpdir(),"kandid-removal-edge-probe-"));
const browser=spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",[
  "--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",
  "--remote-allow-origins=*","--remote-debugging-port=0",`--user-data-dir=${profile}`,
  "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND","about:blank",
],{windowsHide:true,stdio:"ignore"});
let socket;
const result={browser:"Microsoft Edge",fresh_profile:true,external_requests:0,status:"BLOCKED",version:null,reason:null};
try {
 let port;
 for(let n=0;n<80;n++){
  try {port=Number(readFileSync(join(profile,"DevToolsActivePort"),"utf8").split("\n")[0]);break;} catch{await delay(100);}
 }
 if(!port)throw Error("Fresh Edge debugging endpoint unavailable");
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const target=targets.find(item=>item.type==="page");
 if(!target)throw Error("Fresh Edge has no page target");
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((accept,reject)=>{socket.onopen=accept;socket.onerror=reject;});
 let serial=0;const pending=new Map();
 socket.onmessage=({data})=>{const message=JSON.parse(data);const call=pending.get(message.id);if(call){pending.delete(message.id);message.error?call.reject(Error(message.error.message)):call.accept(message.result);}};
 const send=(method)=>new Promise((accept,reject)=>{const id=++serial;pending.set(id,{accept,reject});socket.send(JSON.stringify({id,method}));setTimeout(()=>{if(pending.delete(id))reject(Error(`Fresh Edge timed out: ${method}`));},8000).unref();});
 result.version=(await send("Browser.getVersion")).product;
 await send("Page.enable");
 result.status="AVAILABLE";
} catch(error){result.reason=error.message;}
finally{
 if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({id:9999,method:"Browser.close"}));await delay(100);socket.close();}
 browser.kill();
 writeFileSync(resolve(import.meta.dirname,"../deploy/election-soft-removal-review/evidence/browser-availability.json"),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}
