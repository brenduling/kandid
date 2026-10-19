import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createBoardStudentRegistrationHandler } from "./registryHandler.mjs";
import { serveWithKandidCors } from "./kandidRegistryCors.mjs";

serveWithKandidCors(createBoardStudentRegistrationHandler({
  createClient,
  getEnv: (name: string) => Deno.env.get(name),
}));
