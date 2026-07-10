import { createClient } from "@supabase/supabase-js";

// Server-only client using the Service Role Key. This BYPASSES Row Level
// Security, so it must NEVER be imported into client-side ("use client")
// code — only inside API routes (src/app/api/**) that run on the server.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
