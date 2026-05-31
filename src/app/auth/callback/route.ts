import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!supabaseUrl.startsWith('http') || !supabaseKey) {
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=Supabase+credentials+are+not+configured+in+your+Vercel+environment+variables.+Please+add+NEXT_PUBLIC_SUPABASE_URL+and+NEXT_PUBLIC_SUPABASE_ANON_KEY+in+Vercel.`
    );
  }

  // Create the redirect response object first so we can bind cookies to it directly
  const response = NextResponse.redirect(requestUrl.origin);

  if (code) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response.cookies.set(name, value, options);
            });
          } catch (error) {
            console.error('Error writing cookies to response:', error);
          }
        },
      },
    });

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

  // Return the redirect response containing the newly set cookies
  return response;
}
