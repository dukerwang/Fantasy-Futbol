import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@futbolpedia/engine'],
  serverExternalPackages: ['@google/genai'],
  // /guide reads docs/USER_GUIDE.md at request time on the server. Without
  // this, Vercel's file tracer can omit the markdown and the page 500s.
  outputFileTracingIncludes: {
    '/guide': ['./docs/USER_GUIDE.md'],
    '/league/[leagueId]/guide': ['./docs/USER_GUIDE.md'],
  },
};

export default nextConfig;
