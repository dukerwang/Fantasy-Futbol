import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const { email, password, username } = await req.json();

  if (!email || !password || !username) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Browser-side client to create the auth user (uses anon key)
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: authData, error: authError } = await anonClient.auth.signUp({ email, password });
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }
  if (!authData.user) {
    return NextResponse.json({ error: 'Signup failed — no user returned' }, { status: 500 });
  }

  // Service-role client to insert the profile row (bypasses RLS)
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: profileError } = await adminClient
    .from('users')
    .update({
      email,
      username,
    })
    .eq('id', authData.user.id);

  if (profileError) {
    // Roll back the auth user so the account isn't half-created
    await adminClient.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
