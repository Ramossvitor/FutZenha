import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { comRetentativa, ehLeitura } from "./retry";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL não definida. Local: copie .env.example para .env e rode `docker compose up -d`. " +
      "Produção: conecte o banco Neon ao projeto na Vercel (Storage → Connect Database).",
  );
}

// Reusa a conexão entre hot-reloads em dev para não esgotar o pool.
const globalForDb = globalThis as unknown as { conn?: ReturnType<typeof postgres> };

const conn =
  globalForDb.conn ??
  postgres(url, {
    // A string pooled do Neon passa por PgBouncer em transaction mode, que não
    // suporta prepared statements. Sem isto, toda query falha em produção.
    prepare: false,
    // Não é "uma conexão por request": com Fluid Compute a mesma instância
    // atende várias requests ao mesmo tempo, e max:1 enfileirava TODAS as
    // queries numa conexão só — Promise.all virava serial, e a varredura de
    // pendências (transação via after()) pendurava a request seguinte.
    max: 5,
    idle_timeout: 20,
    // O compute do Neon hiberna sem tráfego e pode levar mais de 10s para
    // acordar; com 10 aqui, a primeira visita do dia estourava CONNECT_TIMEOUT
    // e a segunda funcionava. Só passa a valer alguma coisa porque o
    // src/app/layout.tsx declara `maxDuration = 60`: herdando o default do
    // plano, a função morreria antes destes 30s e o erro chegaria como 504
    // opaco em vez de passar pelo src/app/error.tsx.
    connect_timeout: 30,
    // Sem isto o postgres.js consulta pg_catalog a cada reconexão — e com
    // idle_timeout de 20s reconectar é rotina. Seguro neste app: não há coluna
    // .array() e o drizzle serializa e parseia os valores por conta própria.
    // Se um dia entrar `sql.array()` cru do postgres.js, reavaliar.
    fetch_types: false,
  });
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

type Cliente = ReturnType<typeof postgres>;
type QueryPendente = ReturnType<Cliente["unsafe"]>;

/**
 * Os métodos do postgres.js que configuram a query e devolvem uma query — o
 * drizzle usa `.values()`. Precisam de nome porque a retentativa monta um
 * objeto novo e tem que refazer as mesmas chamadas nele.
 */
const ENCADEAVEIS = ["raw", "values", "simple"] as const;
type Encadeavel = (typeof ENCADEAVEIS)[number];

function ehEncadeavel(prop: string | symbol): prop is Encadeavel {
  return (ENCADEAVEIS as readonly (string | symbol)[]).includes(prop);
}

function encadear(query: QueryPendente, nome: Encadeavel): void {
  if (nome === "raw") query.raw();
  else if (nome === "values") query.values();
  else query.simple();
}

/**
 * O drizzle manda toda query avulsa por `client.unsafe()` — às vezes com
 * `.values()`. Aqui só o CONSUMO (`then`/`catch`/`finally`) passa pelo funil de
 * retentativa.
 *
 * É um Proxy, e não um objeto artesanal com `as unknown as`, porque o cast
 * apagava a única checagem que perceberia o dia em que o drizzle passasse a
 * chamar `.cursor()` ou `.describe()` numa leitura — e esse dia seria TypeError
 * em toda query, em produção, com build verde. Delegando, o pior caso vira
 * "roda sem retentativa".
 *
 * Transações (`begin()`) ficam de fora de propósito: um COMMIT pode ter sido
 * aplicado com o ack perdido, e reexecutar o callback duplicaria a transação
 * inteira.
 */
function unsafeComRetentativa(...args: Parameters<Cliente["unsafe"]>): QueryPendente {
  const alvo = conn.unsafe(...args);
  if (!ehLeitura(String(args[0]))) return alvo;

  // A segunda tentativa é uma query NOVA: sem repetir os encadeáveis, um
  // `.values()` valeria só na primeira e o retry devolveria objetos onde o
  // drizzle espera arrays posicionais.
  const encadeados: Encadeavel[] = [];
  const executa = () => {
    const query = conn.unsafe(...args);
    for (const nome of encadeados) encadear(query, nome);
    return query;
  };

  return new Proxy(alvo, {
    get(query, prop, receiver) {
      // Devolvem função, e não o resultado: a query só pode rodar quando o
      // consumidor CHAMAR, não quando ele apenas ler a propriedade.
      if (prop === "then") {
        return (ok?: (valor: unknown) => unknown, falha?: (erro: unknown) => unknown) =>
          comRetentativa(executa).then(ok, falha);
      }
      if (prop === "catch") {
        return (falha?: (erro: unknown) => unknown) => comRetentativa(executa).catch(falha);
      }
      if (prop === "finally") {
        return (fim?: () => void) => comRetentativa(executa).finally(fim);
      }
      if (ehEncadeavel(prop)) {
        return () => {
          encadeados.push(prop);
          // No alvo também, para quem sair do funil por um método delegado
          // (`.cursor()`, `.forEach()`) enxergar a mesma query configurada.
          encadear(query, prop);
          return receiver;
        };
      }
      const valor = Reflect.get(query, prop);
      return typeof valor === "function"
        ? (valor as (...a: never[]) => unknown).bind(query)
        : valor;
    },
  });
}

/**
 * O client que o drizzle enxerga: igual ao postgres.js em tudo, menos no funil
 * acima. Um Proxy — e não um objeto novo — porque o drizzle também lê
 * `options.parsers`/`options.serializers` do client na inicialização.
 */
const connComRetentativa = new Proxy(conn, {
  get(alvo, prop, receiver) {
    if (prop === "unsafe") return unsafeComRetentativa;
    const valor = Reflect.get(alvo, prop, receiver);
    return typeof valor === "function" ? (valor as (...a: never[]) => unknown).bind(alvo) : valor;
  },
});

export const db = drizzle(connComRetentativa, { schema });

/**
 * O `db` ou o `tx` de dentro de uma transação.
 *
 * É o que deixa as etapas do ciclo de avaliação comporem num commit só —
 * fechar a rodada, rodar o replay e notificar acontecem juntos ou não
 * acontecem. Declarar aqui, e não em cada módulo, evita que um deles aceite um
 * executor que os outros da mesma cadeia não aceitariam.
 */
export type Executor = Pick<
  typeof db,
  "select" | "selectDistinct" | "insert" | "update" | "delete" | "execute"
>;
