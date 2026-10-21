// Offline preparation of PUBLIC dependency code only. Never reads app source/env.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";

const directory=resolve(".tmp/voting-backend-runtime");
const cache=resolve(directory,"public-dependency-cache");
const output=resolve(directory,"public-vendor");
const graph=JSON.parse(readFileSync(resolve(directory,"public-graph.json"),"utf8").replace(/^\uFEFF/,""));
const modules=new Map(graph.modules.map(module=>[module.specifier,module]));
function canonical(url) {
  const seen=new Set();
  while(graph.redirects?.[url]) { assert.ok(!seen.has(url));seen.add(url);url=graph.redirects[url]; }
  return url;
}
mkdirSync(output,{recursive:true});
const manifest=[];
for(const [name,url] of [["sdk","https://esm.sh/@supabase/supabase-js@2.104.1"],["ethers","https://esm.sh/ethers@6.16.0"]]) {
  const result=await build({stdin:{contents:`export * from ${JSON.stringify(url)};`,loader:"js",sourcefile:"public-entry.js"},bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",plugins:[{
    name:"offline-public-cache",
    setup(plugin) {
      plugin.onResolve({filter:/.*/},args=>{
        if(args.path.startsWith("node:"))return {path:args.path,external:true};
        const resolved=canonical(args.path.startsWith("https://")?args.path:new URL(args.path,args.importer).href);
        assert.ok(resolved.startsWith("https://esm.sh/"),"Only cached public esm.sh modules may be read");
        assert.ok(modules.has(resolved),"Missing cached public module: "+resolved);
        return {path:resolved,namespace:"public-cache"};
      });
      plugin.onLoad({filter:/.*/,namespace:"public-cache"},args=>{
        const module=modules.get(args.path);
        assert.ok(module.local?.startsWith("/cache/"));
        const file=resolve(cache,module.local.slice("/cache/".length));
        assert.ok(file.startsWith(cache+sep));
        return {contents:readFileSync(file,"utf8"),loader:"js"};
      });
    },
  }]});
  const contents=result.outputFiles[0].contents;
  writeFileSync(resolve(output,name+".mjs"),contents);
  manifest.push({url,file:name+".mjs",bytes:contents.length,sha256:createHash("sha256").update(contents).digest("hex")});
}
writeFileSync(resolve(output,"import-map.json"),JSON.stringify({imports:Object.fromEntries(manifest.map(item=>[item.url,"file:///vendor/"+item.file]))},null,2)+"\n");
writeFileSync(resolve(output,"manifest.json"),JSON.stringify({publicOnly:true,networkUsed:false,dependencies:manifest},null,2)+"\n");
console.log(JSON.stringify({publicOnly:true,networkUsed:false,dependencies:manifest}));
