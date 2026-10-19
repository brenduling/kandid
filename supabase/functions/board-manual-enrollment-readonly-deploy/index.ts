import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createReadOnlyRegistryHandler } from "./registryHandler.mjs";
import { serveWithKandidCors } from "./kandidRegistryCors.mjs";

serveWithKandidCors(createReadOnlyRegistryHandler({
  createClient,
  getEnv: (name: string) => Deno.env.get(name),
}));
