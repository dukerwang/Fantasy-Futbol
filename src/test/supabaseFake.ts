/**
 * src/test/supabaseFake.ts
 *
 * A table-backed stand-in for the Supabase JS client, so the API route
 * handlers can be tested.
 *
 * Most of Gaffa's game logic lives inside route handlers rather than in
 * `src/lib` (CLAUDE.md says so, and the bid, trade, loan and listing routes
 * all validate and mutate in place). Those handlers were untestable for one
 * reason: every branch runs off a `supabase` query, and the only way to reach
 * a branch was to have a real database in the right state.
 *
 * This fake resolves queries against plain in-memory rows, so a test declares
 * the state it wants ("this club has 22 players, one of them healthy on IR")
 * and calls the handler. It implements the slice of PostgREST the handlers
 * actually use, not the whole surface:
 *
 *   filters      eq, neq, in, is, not, gt, gte, lt, lte, or, contains
 *   shaping      select, order, limit, range, single, maybeSingle
 *   counting     select(cols, { count: 'exact', head: true })
 *   embedding    to-one only: `player:players(name)`, `team_a:teams!team_a_id(user_id)`
 *   writes       insert, update, upsert, delete, each with an optional .select()
 *   rpc          stubbed per test; an unstubbed name throws rather than returning null
 *
 * Deliberate design choices, each one because the alternative hides a bug:
 *
 * - An unstubbed RPC THROWS. Returning `{ data: null }` would let a handler
 *   that forgot to call the RPC still look like it passed.
 * - `single()` errors on 0 or 2+ rows, `maybeSingle()` on 2+, matching
 *   PostgREST. The bid route carries a comment about a `maybeSingle()` that
 *   threw on two released-player rows; a lenient fake could not have caught it.
 * - Filters run in declaration order over a COPY of the rows, so a handler
 *   that mutates what it read cannot corrupt later reads in the same test.
 * - Unknown tables read as empty rather than throwing, because a handler
 *   touching a table the test did not seed is usually testing something else.
 *   Writes to an unknown table create it, so assertions can still see them.
 */

export type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

export interface RpcHandlers {
  [name: string]: (args: Record<string, any>) => any;
}

export interface FakeOptions {
  rpc?: RpcHandlers;
  /**
   * Foreign keys for embedded selects, as `table -> column`. Only needed when
   * the column is not the singularised table name plus `_id`, and only when
   * the query itself does not spell it out with `!column`.
   */
  foreignKeys?: Record<string, string>;
}

interface Filter {
  kind: 'eq' | 'neq' | 'in' | 'is' | 'not' | 'gt' | 'gte' | 'lt' | 'lte' | 'or' | 'contains';
  column?: string;
  value?: any;
  /** `not` only: the operator being negated. */
  op?: string;
}

/** Every write the fake applied, in order, for assertions. */
export interface RecordedWrite {
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete';
  rows: Row[];
}

export interface FakeClient {
  from(table: string): QueryBuilder;
  rpc(name: string, args?: Record<string, any>): Promise<{ data: any; error: any }>;
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: null }> };
  /** Test-only handles. Not part of the Supabase surface. */
  __tables: Tables;
  __writes: RecordedWrite[];
  __rpcCalls: Array<{ name: string; args: Record<string, any> }>;
}

function pgError(code: string, message: string) {
  return { code, message, details: null, hint: null };
}

/**
 * `players` -> `player_id`. PostgREST infers the FK from the schema; here the
 * convention covers every embed in the routes under test, and `!column`
 * overrides it wherever a table is joined twice (trade_proposals -> teams).
 */
function defaultForeignKey(table: string): string {
  return `${table.replace(/ies$/, 'y').replace(/s$/, '')}_id`;
}

interface Embed {
  alias: string;
  table: string;
  fk: string | null;
  columns: string[];
}

/**
 * PostgREST lets an embed disambiguate by CONSTRAINT name as well as column
 * name — `teams!trade_proposals_team_a_id_fkey`. Both spellings appear in the
 * routes, so unwrap the constraint form back to the column it is named after
 * rather than looking up a column that does not exist.
 */
function resolveForeignKey(table: string, embed: Embed, opts: FakeOptions): string {
  if (embed.fk) {
    const named = embed.fk.endsWith('_fkey')
      ? embed.fk.slice(0, -'_fkey'.length).replace(new RegExp(`^${table}_`), '')
      : embed.fk;
    return named;
  }
  return opts.foreignKeys?.[embed.table] ?? defaultForeignKey(embed.table);
}

/**
 * Splits a select list on commas that are not inside parentheses, so
 * `id, player:players(name, age), status` yields three parts and not five.
 */
function splitTopLevel(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseSelect(select: string): { columns: string[]; embeds: Embed[] } {
  const columns: string[] = [];
  const embeds: Embed[] = [];

  for (const part of splitTopLevel(select)) {
    const open = part.indexOf('(');
    if (open === -1) {
      columns.push(part);
      continue;
    }
    const head = part.slice(0, open);
    const inner = part.slice(open + 1, part.lastIndexOf(')'));

    // `alias:table!fk` — alias and fk are both optional.
    const [aliasPart, tablePart] = head.includes(':')
      ? [head.slice(0, head.indexOf(':')), head.slice(head.indexOf(':') + 1)]
      : [head, head];
    const [table, fk] = tablePart.includes('!')
      ? [tablePart.slice(0, tablePart.indexOf('!')), tablePart.slice(tablePart.indexOf('!') + 1)]
      : [tablePart, null];

    embeds.push({
      alias: aliasPart.trim(),
      table: table.trim(),
      fk: fk ? fk.trim() : null,
      columns: splitTopLevel(inner),
    });
  }

  return { columns, embeds };
}

/** `("ir","taxi")` and `(ir,taxi)` both mean the same list. */
function parseList(value: any): any[] {
  if (Array.isArray(value)) return value;
  const text = String(value).trim();
  const body = text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1) : text;
  if (!body) return [];
  return body.split(',').map((v) => {
    const t = v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    return t;
  });
}

function compare(op: string, left: any, right: any): boolean {
  switch (op) {
    case 'eq':
      // PostgREST compares as text, so 5 and '5' match. Nulls never match eq.
      if (left === null || left === undefined) return false;
      return String(left) === String(right);
    case 'neq':
      if (left === null || left === undefined) return true;
      return String(left) !== String(right);
    case 'in':
      if (left === null || left === undefined) return false;
      return parseList(right).some((v) => String(v) === String(left));
    case 'is':
      if (right === null || right === 'null') return left === null || left === undefined;
      if (right === true || right === 'true') return left === true;
      if (right === false || right === 'false') return left === false;
      return left === right;
    case 'gt':
      return left != null && left > right;
    case 'gte':
      return left != null && left >= right;
    case 'lt':
      return left != null && left < right;
    case 'lte':
      return left != null && left <= right;
    case 'cs': {
      // `col.cs.{a,b}` — array contains.
      const wanted = parseList(String(right).replace(/^\{(.*)\}$/, '$1'));
      const actual = Array.isArray(left) ? left : [];
      return wanted.every((w) => actual.some((a) => String(a) === String(w)));
    }
    default:
      throw new Error(`supabaseFake: unsupported operator "${op}"`);
  }
}

/** `team_a_id.eq.X,team_b_id.eq.Y` — any clause matching passes the row. */
function matchesOr(row: Row, expression: string): boolean {
  const clauses = splitTopLevel(expression);
  return clauses.some((clause) => {
    const first = clause.indexOf('.');
    const second = clause.indexOf('.', first + 1);
    if (first === -1 || second === -1) {
      throw new Error(`supabaseFake: cannot parse or() clause "${clause}"`);
    }
    const column = clause.slice(0, first);
    const op = clause.slice(first + 1, second);
    const value = clause.slice(second + 1);
    return compare(op, row[column], value);
  });
}

class QueryBuilder implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private filters: Filter[] = [];
  private selectStr = '*';
  private orderBy: Array<{ column: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private rangeFromTo: [number, number] | null = null;
  private countMode: string | null = null;
  private headOnly = false;
  private singleMode: 'one' | 'maybe' | null = null;
  private write: { op: 'insert' | 'update' | 'upsert' | 'delete'; payload: any; onConflict?: string } | null = null;
  private returnRows = false;

  constructor(
    private table: string,
    private store: Tables,
    private writes: RecordedWrite[],
    private opts: FakeOptions,
  ) {}

  select(columns = '*', options?: { count?: string; head?: boolean }) {
    // On a write, .select() means "return the affected rows"; on a read it
    // picks the shape.
    if (this.write) {
      this.returnRows = true;
      this.selectStr = columns;
      return this;
    }
    this.selectStr = columns;
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headOnly = true;
    return this;
  }

  eq(column: string, value: any) { this.filters.push({ kind: 'eq', column, value }); return this; }
  neq(column: string, value: any) { this.filters.push({ kind: 'neq', column, value }); return this; }
  in(column: string, value: any[]) { this.filters.push({ kind: 'in', column, value }); return this; }
  is(column: string, value: any) { this.filters.push({ kind: 'is', column, value }); return this; }
  gt(column: string, value: any) { this.filters.push({ kind: 'gt', column, value }); return this; }
  gte(column: string, value: any) { this.filters.push({ kind: 'gte', column, value }); return this; }
  lt(column: string, value: any) { this.filters.push({ kind: 'lt', column, value }); return this; }
  lte(column: string, value: any) { this.filters.push({ kind: 'lte', column, value }); return this; }
  contains(column: string, value: any) { this.filters.push({ kind: 'contains', column, value }); return this; }
  not(column: string, op: string, value: any) { this.filters.push({ kind: 'not', column, op, value }); return this; }
  or(expression: string) { this.filters.push({ kind: 'or', value: expression }); return this; }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(n: number) { this.limitN = n; return this; }

  range(from: number, to: number) { this.rangeFromTo = [from, to]; return this; }

  maybeSingle() { this.singleMode = 'maybe'; return this; }

  insert(payload: Row | Row[]) { this.write = { op: 'insert', payload }; return this; }
  update(payload: Row) { this.write = { op: 'update', payload }; return this; }
  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.write = { op: 'upsert', payload, onConflict: options?.onConflict };
    return this;
  }
  delete() { this.write = { op: 'delete', payload: null }; return this; }

  /**
   * PostgREST's `.single()` is an error, not an empty result, when the row
   * count is not exactly one. Handlers lean on that: several read `{ data }`
   * and branch on it being null, which only happens because the error path
   * nulls the data.
   */
  async single(): Promise<{ data: any; error: any }> {
    this.singleMode = 'one';
    return this.run() as Promise<{ data: any; error: any }>;
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private rows(): Row[] {
    return this.store[this.table] ?? [];
  }

  private matching(): Row[] {
    let rows = this.rows().slice();
    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        switch (filter.kind) {
          case 'or':
            return matchesOr(row, filter.value);
          case 'not':
            return !compare(filter.op!, row[filter.column!], filter.value);
          case 'contains':
            return compare('cs', row[filter.column!], filter.value);
          default:
            return compare(filter.kind, row[filter.column!], filter.value);
        }
      });
    }
    return rows;
  }

  private sorted(rows: Row[]): Row[] {
    if (this.orderBy.length === 0) return rows;
    return rows.slice().sort((a, b) => {
      for (const { column, ascending } of this.orderBy) {
        const av = a[column];
        const bv = b[column];
        if (av === bv) continue;
        // Nulls sort last in PostgREST's default for both directions.
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av < bv ? -1 : 1;
        return ascending ? cmp : -cmp;
      }
      return 0;
    });
  }

  private shape(rows: Row[]): Row[] {
    const { columns, embeds } = parseSelect(this.selectStr);
    const takeAll = columns.includes('*') || (columns.length === 0 && embeds.length === 0);

    return rows.map((row) => {
      const out: Row = takeAll ? { ...row } : {};
      if (!takeAll) {
        for (const column of columns) {
          if (column === '*') continue;
          out[column] = row[column] ?? null;
        }
      }
      for (const embed of embeds) {
        const fk = resolveForeignKey(this.table, embed, this.opts);
        const foreignId = row[fk];
        const related = foreignId == null
          ? null
          : (this.store[embed.table] ?? []).find((r) => String(r.id) === String(foreignId)) ?? null;

        if (!related) {
          out[embed.alias] = null;
          continue;
        }
        const takeAllInner = embed.columns.includes('*');
        const shaped: Row = takeAllInner ? { ...related } : {};
        if (!takeAllInner) {
          for (const column of embed.columns) shaped[column] = related[column] ?? null;
        }
        out[embed.alias] = shaped;
      }
      return out;
    });
  }

  private applyWrite(): { data: any; error: any } {
    const table = this.table;
    if (!this.store[table]) this.store[table] = [];
    const rows = this.store[table];
    const write = this.write!;

    if (write.op === 'delete') {
      const doomed = this.matching();
      const doomedIds = new Set(doomed.map((r) => r));
      this.store[table] = rows.filter((r) => !doomedIds.has(r));
      this.writes.push({ table, op: 'delete', rows: doomed });
      return { data: this.returnRows ? this.shape(doomed) : null, error: null };
    }

    if (write.op === 'update') {
      const targets = this.matching();
      for (const target of targets) Object.assign(target, write.payload);
      this.writes.push({ table, op: 'update', rows: targets });
      return { data: this.returnRows ? this.shape(targets) : null, error: null };
    }

    const incoming: Row[] = (Array.isArray(write.payload) ? write.payload : [write.payload]).map((r) => ({ ...r }));
    for (const row of incoming) {
      if (row.id === undefined) row.id = `${table}-${rows.length + 1}`;
    }

    if (write.op === 'upsert' && write.onConflict) {
      const keys = write.onConflict.split(',').map((k) => k.trim());
      for (const row of incoming) {
        const existing = rows.find((r) => keys.every((k) => String(r[k]) === String(row[k])));
        if (existing) Object.assign(existing, row);
        else rows.push(row);
      }
    } else {
      rows.push(...incoming);
    }

    this.writes.push({ table, op: write.op, rows: incoming });
    return { data: this.returnRows ? this.shape(incoming) : null, error: null };
  }

  private async run(): Promise<{ data: any; error: any; count?: number | null }> {
    if (this.write) {
      const result = this.applyWrite();
      if (this.singleMode === 'one' || this.singleMode === 'maybe') {
        const list = (result.data ?? []) as Row[];
        return { data: list[0] ?? null, error: null };
      }
      return result;
    }

    let rows = this.sorted(this.matching());
    const total = rows.length;

    if (this.rangeFromTo) {
      const [from, to] = this.rangeFromTo;
      rows = rows.slice(from, to + 1);
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);

    if (this.headOnly) {
      return { data: null, error: null, count: this.countMode ? total : null };
    }

    const shaped = this.shape(rows);

    if (this.singleMode === 'one') {
      if (shaped.length !== 1) {
        return {
          data: null,
          error: pgError(
            'PGRST116',
            shaped.length === 0
              ? 'JSON object requested, multiple (or no) rows returned'
              : `JSON object requested, multiple (or no) rows returned (${shaped.length})`,
          ),
        };
      }
      return { data: shaped[0], error: null };
    }

    if (this.singleMode === 'maybe') {
      if (shaped.length > 1) {
        return {
          data: null,
          error: pgError('PGRST116', `JSON object requested, multiple (or no) rows returned (${shaped.length})`),
        };
      }
      return { data: shaped[0] ?? null, error: null };
    }

    return { data: shaped, error: null, count: this.countMode ? total : null };
  }
}

/**
 * Builds a fake admin client over `tables`. The rows are held by reference, so
 * a test can assert against the same objects the handler mutated.
 */
export function createFakeSupabase(tables: Tables, options: FakeOptions = {}): FakeClient {
  const store: Tables = tables;
  const writes: RecordedWrite[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, any> }> = [];

  return {
    __tables: store,
    __writes: writes,
    __rpcCalls: rpcCalls,
    from(table: string) {
      return new QueryBuilder(table, store, writes, options);
    },
    async rpc(name: string, args: Record<string, any> = {}) {
      rpcCalls.push({ name, args });
      const handler = options.rpc?.[name];
      if (!handler) {
        throw new Error(
          `supabaseFake: rpc("${name}") was called but not stubbed. Add it to the rpc option, ` +
          `or assert the handler should not have reached it.`,
        );
      }
      const result = handler(args);
      // A handler may return the RPC's payload directly, or the full envelope.
      // The envelope is recognised by its `data` key alone: a Gaffa RPC payload
      // routinely carries its own `error` field alongside `success: false`, and
      // treating that as a transport error would turn a 400 refusal into a 500.
      if (result && typeof result === 'object' && 'data' in result) {
        return result as { data: any; error: any };
      }
      return { data: result, error: null };
    },
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
    },
  };
}

/** The `@/lib/supabase/server` client: auth only, as the routes use it. */
export function createFakeServerClient(user: { id: string } | null) {
  return {
    auth: {
      async getUser() {
        return { data: { user }, error: null };
      },
    },
  };
}
