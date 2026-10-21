// Actual Edge Runtime boot/auth/CORS checks. All containers have NO external net.
// Prerequisite: public dependency cache/graph and offline vendor preparation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync,copyFileSync } from "node:fs";
import { randomBytes,createHash } from "node:crypto";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const directory=resolve(root,".tmp/voting-backend-runtime");
const image="public.ecr.aws/supabase/edge-runtime:v1.77.6";
const imageDigest="sha256:18f2af582e34fde1143eb7dbd5129245e19b46be18f24886d957b1877cf659c0";
const dockerArgs=["--config",resolve(root,".tmp/election-3-rule-validation/docker"),"--host","npipe:////./pipe/dockerDesktopLinuxEngine"];
const docker=args=>spawnSync("docker",[...dockerArgs,...args],{encoding:"utf8",windowsHide:true,maxBuffer:8*1024*1024,timeout:60000});
function checked(args) {const result=docker(args);assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout.trim();}
const inspected=JSON.parse(checked(["image","inspect",image]))[0];
assert.ok(inspected.RepoDigests.some(value=>value.endsWith("@"+imageDigest)));
const originalSource=resolve(root,"supabase/functions"),vendor=resolve(directory,"public-vendor");
const source=resolve(directory,"offline-source");
const bundles=resolve(directory,"offline-bundles");mkdirSync(bundles,{recursive:true});
const mount=(local,target,readonly=true)=>["--mount",`type=bind,source=${local},target=${target}${readonly?",readonly":""}`];
const functions=["get-student-ballot-receipt","submit-vote","anchor-ballot-hashes"];
// The Edge Runtime's eszip import-map path did not retain the public aliases.
// In this TEST COPY ONLY, resolve the two pinned public URLs to local bundles.
// Original app files and all handler logic remain unchanged.
mkdirSync(resolve(source,"_public"),{recursive:true});
mkdirSync(resolve(source,"_shared"),{recursive:true});
for(const name of ["sdk.mjs","ethers.mjs"])copyFileSync(resolve(vendor,name),resolve(source,"_public",name));
for(const name of ["kandidProductionSecurity.mjs","ballotSelection.js","currentTermEnrollment.js","geofence.js"])copyFileSync(resolve(originalSource,"_shared",name),resolve(source,"_shared",name));
for(const name of functions){
  mkdirSync(resolve(source,name),{recursive:true});
  const original=readFileSync(resolve(originalSource,name,"index.ts"),"utf8");
  assert.ok(original.includes("https://esm.sh/@supabase/supabase-js@2.104.1"));
  writeFileSync(resolve(source,name,"index.ts"),original.replace("https://esm.sh/@supabase/supabase-js@2.104.1","../_public/sdk.mjs").replace("https://esm.sh/ethers@6.16.0","../_public/ethers.mjs"));
}
const results=[];
for(const name of functions) {
  checked(["run","--rm","--network","none",...mount(source,"/functions"),...mount(bundles,"/out",false),image,"bundle","--entrypoint",`/functions/${name}/index.ts`,"--output",`/out/${name}.eszip`,"--checksum","sha256","--timeout","40"]);
  const file=resolve(bundles,name+".eszip"),bytes=readFileSync(file);
  const container="kandid-voting-runtime-"+randomBytes(6).toString("hex");
  try {
    checked(["run","--detach","--network","none","--name",container,"--label","kandid.task=voting-backend-offline-check",
      "--env","SUPABASE_URL=https://synthetic.invalid","--env","SUPABASE_ANON_KEY=synthetic-anon",
      "--env","SUPABASE_SERVICE_ROLE_KEY=synthetic-service","--env","ANCHOR_WORKER_TOKEN=synthetic-worker",
      ...mount(bundles,"/artifacts"),...mount(vendor,"/vendor"),...mount(source,"/functions"),
      image,"start","--main-service",`/artifacts/${name}.eszip`]);
    const state=JSON.parse(checked(["inspect",container]))[0];
    assert.equal(state.HostConfig.NetworkMode,"none");
    assert.equal(state.Config.Labels["kandid.task"],"voting-backend-offline-check");
    const worker=name==="anchor-ballot-hashes";
    const probe=`
      const origin="https://witkandid.vercel.app";
      const checks=${JSON.stringify(worker?[
        {method:"GET",status:405},{method:"POST",status:401,headers:{"x-anchor-worker-token":"wrong"}},
      ]:[
        {method:"OPTIONS",status:204,headers:{Origin:"https://witkandid.vercel.app","Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"authorization,apikey,content-type"}},
        {method:"POST",status:401,headers:{Origin:"https://witkandid.vercel.app"}},
        {method:"GET",status:405,headers:{Origin:"https://witkandid.vercel.app"}},
        {method:"POST",status:403,headers:{Origin:"https://untrusted.invalid"}},
      ])};
      let responses=[];
      for(const item of checks){
        let response;
        for(let attempt=0;attempt<30;attempt++){
          try{response=await fetch("http://127.0.0.1:9000/",{method:item.method,headers:item.headers});if(response.status!==503)break;await response.text();}catch{}
          await new Promise(resolve=>setTimeout(resolve,200));
        }
        if(!response||response.status!==item.status)throw Error("Expected "+item.status+" got "+response?.status);
        if(item.headers?.Origin===origin&&response.headers.get("Access-Control-Allow-Origin")!==origin)throw Error("Missing allowed CORS origin");
        await response.text();responses.push({method:item.method,status:response.status});
      }
      console.log(JSON.stringify(responses));`;
    const responses=JSON.parse(checked(["run","--rm","--network","container:"+container,"denoland/deno:2.1.4","deno","eval",probe]));
    results.push({function:name,sourceSha256:createHash("sha256").update(readFileSync(resolve(originalSource,name,"index.ts"))).digest("hex"),testCopyImportRewritesOnly:true,sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,responses});
    console.log("PASS "+name+" offline bundle/start/auth/CORS");
  } catch(error) {
    const logs=docker(["logs",container]);
    throw new Error(String(error)+"\nSynthetic container logs: "+logs.stdout+logs.stderr);
  } finally {
    assert.match(container,/^kandid-voting-runtime-[a-f0-9]{12}$/);
    checked(["rm","--force",container]);
  }
}
writeFileSync(resolve(bundles,"validation.json"),JSON.stringify({image,imageDigest,network:"none",syntheticOnly:true,
  dependencyManifest:JSON.parse(readFileSync(resolve(vendor,"manifest.json"),"utf8")),results},null,2)+"\n");
console.log(JSON.stringify({functions:results.length,httpChecks:results.reduce((sum,result)=>sum+result.responses.length,0),network:"none",productionConnected:false}));
