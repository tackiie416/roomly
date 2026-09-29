import type { DbClient } from "@/lib/services/result";

/**
 * Cliente Supabase simulado para los tests de lib/services/*.
 *
 * Registra cada consulta (tabla, operación, payload, filtros, columnas y
 * forma de terminar) y responde con lo que devuelva `respond`. No imita
 * PostgREST: solo lo justo para comprobar qué envía cada servicio y cómo
 * reacciona a cada respuesta.
 */

export type Operation = "select" | "insert" | "update" | "delete";

export type Call = {
  table: string;
  operation: Operation;
  payload?: Record<string, unknown>;
  columns?: string;
  filters: Array<{ kind: "eq" | "is"; column: string; value: unknown }>;
  terminal: "single" | "maybeSingle" | "await";
};

export type FakeResponse = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

export type Responder = (call: Call, index: number) => FakeResponse;

export function dbError(code: string, message = "error simulado"): FakeResponse {
  return { data: null, error: { code, message } };
}

export function createFakeSupabase(options: {
  userId: string | null;
  respond?: Responder;
  /** Error que devuelve `auth.exchangeCodeForSession` (sin él, el canje funciona). */
  exchangeError?: { code?: string; message?: string };
}) {
  const calls: Call[] = [];
  const respond: Responder = options.respond ?? (() => ({ data: null, error: null }));

  function builder(table: string) {
    const call: Omit<Call, "terminal"> = { table, operation: "select", filters: [] };
    const finish = (terminal: Call["terminal"]) => {
      const recorded: Call = { ...call, filters: [...call.filters], terminal };
      calls.push(recorded);
      return Promise.resolve(respond(recorded, calls.length - 1));
    };
    const chain = {
      // En lecturas son las columnas leídas; tras insert/update, las devueltas.
      select(columns?: string) {
        call.columns = columns;
        return chain;
      },
      insert(payload: Record<string, unknown>) {
        call.operation = "insert";
        call.payload = payload;
        return chain;
      },
      update(payload: Record<string, unknown>) {
        call.operation = "update";
        call.payload = payload;
        return chain;
      },
      delete() {
        call.operation = "delete";
        return chain;
      },
      eq(column: string, value: unknown) {
        call.filters.push({ kind: "eq", column, value });
        return chain;
      },
      is(column: string, value: unknown) {
        call.filters.push({ kind: "is", column, value });
        return chain;
      },
      single: () => finish("single"),
      maybeSingle: () => finish("maybeSingle"),
      then(
        onFulfilled: (value: FakeResponse) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return finish("await").then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  const authCalls: Array<{ method: string; argument?: unknown }> = [];

  const client = {
    auth: {
      getUser: async () =>
        options.userId
          ? { data: { user: { id: options.userId } }, error: null }
          : { data: { user: null }, error: { message: "Auth session missing!" } },
      exchangeCodeForSession: async (code: string) => {
        authCalls.push({ method: "exchangeCodeForSession", argument: code });
        return options.exchangeError
          ? { data: { session: null, user: null }, error: options.exchangeError }
          : { data: { session: {}, user: { id: options.userId } }, error: null };
      },
      signOut: async () => {
        authCalls.push({ method: "signOut" });
        return { error: null };
      },
    },
    from: (table: string) => builder(table),
  };

  return { client: client as unknown as DbClient, calls, authCalls };
}

/** Todos los payloads de escritura (insert/update) registrados. */
export function writePayloads(calls: Call[]) {
  return calls.filter((call) => call.operation !== "select");
}
