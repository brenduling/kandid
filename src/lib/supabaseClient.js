import {createClient} from "@supabase/supabase-js";
import { recordSupabaseRequest, shouldProfileSupabase } from "../utils/supabaseProfiler";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_KEY;

const profiledFetch = async (input, init) => {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const response = await fetch(input, init);

  if (shouldProfileSupabase()) {
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordSupabaseRequest(input, init, response, endedAt - startedAt);
  }

  return response;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: profiledFetch,
  },
});
