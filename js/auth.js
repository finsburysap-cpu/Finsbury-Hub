// js/auth.js
// Simple session management for Finsbury Hub
// Sessions stored in sessionStorage (cleared on tab close)

import { getSupabase } from './supabase.js';

const SESSION_KEY = 'fh_session';

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSessionSite(site) {
  const session = getSession();
  if (session) {
    session.site = site;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function signIn(email, password) {
  try {
    const sb = getSupabase();

    // Fetch user by email
    const { data: users, error } = await sb
      .from('users')
      .select('id, email, full_name, password_hash, can_access_stock, can_access_ar, is_active')
      .eq('email', email.toLowerCase().trim())
      .eq('is_active', true)
      .limit(1);

    if (error) throw error;
    if (!users || users.length === 0) {
      return { success: false, error: 'Invalid email or password.' };
    }

    const user = users[0];

    // Verify password using Web Crypto (SHA-256 hash comparison)
    // For production: use bcrypt via a Supabase Edge Function
    // For now: compare SHA-256 hash stored in password_hash
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(password)
    );
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (hashHex !== user.password_hash) {
      return { success: false, error: 'Invalid email or password.' };
    }

    // Save session
    const session = {
      userId:         user.id,
      email:          user.email,
      name:           user.full_name,
      canAccessStock: user.can_access_stock,
      canAccessAr:    user.can_access_ar,
      site:           null,   // set on site-select.html
      loginAt:        new Date().toISOString(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

    return { success: true };

  } catch (err) {
    console.error('signIn error:', err);
    return { success: false, error: 'Connection error. Please try again.' };
  }
}
