# Antigravity AI Assistant & Workflow Guide

This document provides complete context on **Antigravity**, the autonomous agentic AI coding assistant designed by Google DeepMind's Advanced Agentic Coding team. Since Antigravity is a newly released, cutting-edge agent system, other AI platforms (such as Claude, standard Gemini, or ChatGPT) lack training data about its existence, planning frameworks, toolsets, and workflow patterns.

Use this document within your Claude Desktop Project to instruct Claude on how to act as an **Architect and Prompt Designer** for Antigravity, helping you coordinate planning, draft structured prompts, and audit codebase modifications.

---

## 1. Overview of Antigravity

Antigravity is an **agentic, tool-equipped, pair-programming assistant** that operates directly on your local system. Unlike chat-only models, Antigravity has the authority to:
- Read, write, and surgically edit files.
- Execute bash commands (Zsh on macOS).
- Spin up background tasks and manage their execution.
- Call specialized Model Context Protocol (MCP) servers (e.g., Supabase, GitHub, Stitch).
- Orchestrate concurrent multi-agent groups.
- Display interactive UI elements (like multiple-choice modals) directly in the user's interface.

---

## 2. Planning & Execution Workflow

Antigravity strictly adheres to a structured **Planning Mode** for any complex, multi-step, or ambiguous tasks. This workflow ensures alignment before modifying files.

### Phase 1: Research (Read-Only)
- Antigravity explores the codebase using file-reading and search tools (`list_dir`, `view_file`, `grep_search`, `search_web`).
- **Constraint**: During this phase, Antigravity is forbidden from modifying any source code or running terminal commands that write files.

### Phase 2: Implementation Plan
- Antigravity creates or updates a detailed design document called `implementation_plan.md` in its local conversation directory:
  `~/.gemini/antigravity/brain/<conversation-id>/implementation_plan.md`
- The plan outlines:
  - **Goal Description**: A high-level summary of the target problem.
  - **User Review Required**: Critical design decisions, breaking changes, or architectural pivots.
  - **Open Questions**: Clear questions that must be answered before coding.
  - **Proposed Changes**: Grouped by component/file with `[NEW]`, `[MODIFY]`, or `[DELETE]` tags and clickable file links.
  - **Verification Plan**: Commands to execute (e.g., tests, build commands) and manual verification steps.
- **Halt & Feedback**: It flags `request_feedback: true` in the metadata, stops calling tools, and **waits for the user's explicit approval** in the chat before proceeding.

### Phase 3: Task Checklist
- Once the user approves the plan, Antigravity creates a TODO list tracking file:
  `~/.gemini/antigravity/brain/<conversation-id>/task.md`
- Tasks are represented as:
  - `[ ]` Uncompleted tasks
  - `[/]` In-progress tasks
  - `[x]` Completed tasks
- This list is updated continuously as Antigravity executes changes.

### Phase 4: Execution & Surgery
- Antigravity implements changes incrementally. It prefers surgical modifications over whole-file rewrites.
- It uses `replace_file_content` for single contiguous edits and `multi_replace_file_content` for non-contiguous edits across a file.

### Phase 5: Verification & Walkthrough
- Antigravity verifies its work (running builds, unit tests, and checking database migrations).
- It compiles a `walkthrough.md` file in the conversation directory summarizing what was changed, what was tested, and the validation outcomes.

---

## 3. Toolset and Capabilities

When collaborating with Antigravity, Claude should know what tools Antigravity has access to, enabling Claude to suggest specific tool-based strategies.

| Tool Category | Key Tools | Description & Guidelines |
| :--- | :--- | :--- |
| **Terminal & Tasks** | `run_command`, `manage_task` | Executes Zsh commands. Runs build processes, scrapers, and local servers. Long-running commands are sent to the background; `manage_task` controls them. |
| **Filesystem** | `view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content` | Reads up to 800 lines of a file at a time. Performs highly efficient search-and-replace surgery using exact target string matches. |
| **Agent Orchestration** | `define_subagent`, `invoke_subagent`, `send_message`, `manage_subagents` | Defines specialized agents (e.g., `research`, `database_debugger`) and lets them run tasks concurrently. |
| **Database & Cloud** | `supabase-mcp-server` | Directly executes SQL queries, retrieves database schemas, lists migrations, runs/rolls back migrations, and manages Edge Functions. |
| **Git & GitHub** | `github-mcp-server` | Standard Git operations, search repositories, create branches, push files, open/merge pull requests. |
| **UI Design System** | `StitchMCP` | Lists screens, creates design systems, generates responsive CSS layouts/variants, and updates UI screen mockups. |
| **Interactions** | `ask_question`, `ask_permission`, `schedule` | Shows interactive multiple-choice modals in the user's client, requests permission adjustments, and schedules timers or recurring cron jobs. |
| **Asset Generation** | `generate_image` | Generates or edits UI mockups and graphics using text-to-image models. |

---

## 4. Slash Commands

The user can trigger special workflows in the chat UI via slash commands. Claude can recommend that the user execute these commands to resolve complex issues:

- `/goal`: Instructs Antigravity to run a long-running task (e.g., overnight) and to be extra thorough, not stopping until the objective is fully completed.
- `/schedule`: Set up recurring cron tasks or one-time execution timers.
- `/browser`: Instructs Antigravity to launch an automated browser to test user flows, inspect layouts, or audit web pages.
- `/grill-me`: Triggers an interactive interview modal where Antigravity asks deep questions to resolve design conflicts and clarify ambiguity.
- `/teamwork-preview`: Orchestrates a team of multiple agents working on a large-scale project concurrently.

---

## 5. How Claude Desktop Can Collaborate with Antigravity

Because Claude Desktop lacks direct terminal access and local database/file control on your machine, it should act as the **Architect, Specifier, and Prompt Engineer**. 

Here is how you can use Claude Desktop to accelerate your work with Antigravity:

### A. Draft Prompts for Antigravity
You can ask Claude: *"Write a prompt for Antigravity to implement a database trigger that enforces Gaffa's £40m transfer auction rules."*
Claude will write a structured prompt, instructing Antigravity:
1. Which tables to check (e.g., `players` and `auctions`).
2. To use `supabase-mcp-server` to inspect the current schema and execute the migration.
3. To enter **Planning Mode** first and create an `implementation_plan.md`.
4. Specific edge cases to handle (like name matching, Resend emails).

### B. Pre-Validate Implementations
Before approving Antigravity's `implementation_plan.md`, paste it into Claude and ask:
- *"Are there any race conditions in this waiver bid resolution plan?"*
- *"Will this layout break CSS Modules naming rules?"*
- Claude can analyze the plan, suggest refinements, and write a reply for you to feed back to Antigravity.

### C. Write Complex Code Blocks for Surgery
If Antigravity struggles to write a complex algorithm (such as the Sigmoid Normalization scoring formulas), Claude can write the clean TypeScript code and specify the exact search-and-replace target lines for Antigravity's `replace_file_content` tool.

---

## 6. Gaffa Project Reference for Claude

To help Claude reason about the Gaffa codebase, provide it with this quick architectural summary:

- **Next.js & React 19**: Located in `src/app/`. Uses Server Components, CSS Modules (strictly no Tailwind), and Framer Motion.
- **Supabase PostgreSQL**: All transactions, bids, and matchups are backed by Supabase. Schema definitions and stored procedures are in `supabase/` or `schema_dump.sql`.
- **Sigmoid Scoring Engine**: Located in `src/lib/scoring.ts` (or similar). Normalizes FPL statistics relative to positional season medians using:
  $$score = \frac{1}{1 + e^{-Z}}, \quad Z = K \cdot \frac{value - median}{stddev}$$
  Outputs display ratings (1.0 to 10.0 scale) and scoring ratings (1.0 to 10.0 scale, mapped to fantasy points using a convex curve).
- **Position & Formation Rules**: 12 specific tactical positions mapped from SoFIFA profiles. Teams submit rosters matching 1 of 7 formations. Starters not playing are replaced by auto-subs at gameweek resolution.
- **Dynasty Reset**: Run via `/api/sync/offseason` or a Postgres script. archives stats, distributes prizes, processes relegated clubs, and advances league metadata.
