import { createClient } from '@supabase/supabase-js'

// Service role client that bypasses RLS - use only for server-side operations
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables for admin client')
  }
  
  return createClient(supabaseUrl, supabaseServiceKey)
}
