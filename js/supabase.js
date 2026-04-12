// js/supabase.js
// Supabase client — update SUPABASE_URL and SUPABASE_ANON_KEY below

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'https://lndoofnrgspzsyqylppj.supabase.co';       // e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuZG9vZm5yZ3NwenN5cXlscHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTQxNTQsImV4cCI6MjA5MTM5MDE1NH0.KfngsHB7wf94nOQw_5O3MrzRaQG9iSn7T3-nbBsnzm4';  // anon/public key (NOT service role)

let _client = null;

export function getSupabase() {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}
