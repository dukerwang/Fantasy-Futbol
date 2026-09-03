# CODEX.md

Guidance for OpenAI Codex working in this repository.

See **[`AGENTS.md`](./AGENTS.md)** for the complete operational instructions:
1. **Frontend & UI design requirements**: Read `DESIGN.md` for tokens and mobile standards; check `docs/DECISIONS.md` before making design assertions.
2. **Writing style**: Follow the Google Developer Documentation Style Guide (`developers.google.com/style`) to eliminate "Claude-lish" AI mannerisms across all UI copy, error messages, and responses.
3. **Agent skills policy**: Recommended (`emil-design-eng`, `apple-design`, `google-dev-style`, `modern-web-guidance`, `impeccable` in `Operate` mode, `full-output-enforcement`, `animate`) vs. banned skills (`industrial-brutalist-ui`, `high-end-visual-design`, `design-taste-frontend` / `gpt-taste`, `minimalist-ui`, `stitch-design-taste`, `image-to-code`).
4. **Resource limits & efficiency**: Vercel Hobby compute limits (batch work locally, avoid unthrottled loops), Supabase free-tier thresholds (pagination, Postgres RPCs), and Google AI Studio caps.
