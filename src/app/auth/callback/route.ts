import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch (error) {
      console.error('Error exchanging OAuth code for session:', error);
      // The code might have already been exchanged (e.g. due to double-mount or refresh).
      // We catch the error to prevent crashing, allowing the redirect to requestUrl.origin.
      // If the exchange succeeded on a prior request, they will have a valid session cookie
      // and be logged in successfully.
    }
  }

  // URL to redirect to after sign in process completes
  return NextResponse.redirect(requestUrl.origin);
}
