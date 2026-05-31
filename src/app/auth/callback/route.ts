import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent(error.message)}`);
      }
    } catch (error: any) {
      console.error('Error exchanging OAuth code for session:', error);
      return NextResponse.redirect(`${requestUrl.origin}/login?error=${encodeURIComponent(error?.message || 'Unknown code exchange error')}`);
    }
  } else {
    // If no code is received, we redirect to login with error
    return NextResponse.redirect(`${requestUrl.origin}/login?error=No+authentication+code+received`);
  }

  // URL to redirect to after sign in process completes
  return NextResponse.redirect(requestUrl.origin);
}
