import "dotenv/config";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { hashPassword } from "../lib/password";
import { platformAdminsDoAmbiente } from "../lib/platform-admins";
import { siteUrl } from "../lib/site-url";

// Roda antes do `next build` (ver package.json). Migrations viajam junto com o
// código: um `git push` na main aplica o schema novo e publica.

// Migrations precisam da connection string DIRETA — a pooled passa por
// PgBouncer, que não serve para DDL em sessão. As duas do meio são injetadas
// pela integração Neon da Vercel; DIRECT_DATABASE_URL é a válvula manual.
function resolveUrl(): string | undefined {
  return (
    process.env.DIRECT_DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL
  );
}

async function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    console.log(`[migrate] VERCEL_ENV=${vercelEnv} — pulando (só produção migra o banco).`);
    return;
  }

  const url = resolveUrl();
  if (!url) {
    if (process.env.VERCEL) {
      console.error(
        "[migrate] Nenhuma connection string encontrada. Conecte o banco Neon ao projeto " +
          "na Vercel (Storage → Connect Database) e refaça o deploy.",
      );
      process.exit(1);
    }
    console.warn("[migrate] Sem DATABASE_URL — pulando migrations (build local).");
    return;
  }

  // O aviso precisa ser barulhento, não fatal: derrubar o build por causa de
  // uma env var que a integração antiga não injeta deixaria produção sem
  // deploy — e DDL transacional simples ainda passa pelo PgBouncer.
  if (process.env.VERCEL && url === process.env.DATABASE_URL) {
    console.warn(
      "[migrate] ATENÇÃO: usando a connection string POOLED (PgBouncer) para migrations. " +
        "Configure DIRECT_DATABASE_URL (ou atualize a integração Neon) — " +
        "CREATE INDEX CONCURRENTLY e afins vão falhar por aqui.",
    );
  }

  // onnotice silencia os "already exists, skipping" que o migrator provoca em
  // toda execução — o log do build fica legível.
  const conn = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(conn), { migrationsFolder: "./drizzle" });
    console.log("[migrate] Migrations aplicadas.");
    await provisionarPlatformAdmins(conn);
    await materializarPlatformAdmins(conn);
  } finally {
    await conn.end();
  }
}

// Mesmos 7 dias de src/lib/convites.ts. Duplicado de propósito: aquele módulo é
// `server-only` e este script roda sob tsx, fora do Next.
const INVITE_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Cria a conta de quem está em `PLATFORM_ADMIN_USERNAMES` e ainda não existe.
 *
 * Faz dois trabalhos que o `materializarPlatformAdmins` sozinho não fazia.
 *
 * O primeiro é **reservar o username**. A env var dá admin pelo *nome*, e quem
 * resgata um convite escolhe o próprio username: enquanto um nome da lista não
 * tivesse dono, qualquer portador de convite podia digitá-lo e sair admin da
 * plataforma — o proxy não é fronteira (Server Action é POST direto), então a
 * conta valia de verdade. Com a linha em `users` criada aqui, o nome já está
 * tomado e o resgate cai no ramo de "conta existente".
 *
 * O segundo é **destravar a instalação nova**. Sem `ADMIN_PASSWORD` não sobrou
 * ninguém que pudesse gerar o primeiro convite: `createInvite` exige admin da
 * plataforma e `convidarParaPelada` exige jogador logado. O convite impresso
 * aqui é a única porta de entrada de um banco vazio.
 *
 * A senha nasce aleatória e é descartada — só se entra pelo convite, que para
 * conta existente funciona como redefinição de senha.
 */
async function provisionarPlatformAdmins(conn: postgres.Sql) {
  const usernames = [...platformAdminsDoAmbiente()];
  if (usernames.length === 0) return;

  for (const username of usernames) {
    const [existente] = await conn`select id from users where username = ${username}`;
    if (existente) continue;

    // Um jogador com esse nome e sem conta serve; senão cria. Se o nome existe
    // e já tem conta com OUTRO username, `users.player_id` é unique e a linha
    // não caberia — avisa e sai, porque adivinhar outro nome seria pior.
    const [jogador] = await conn`
      select p.id, (u.id is not null) as "temConta"
        from players p left join users u on u.player_id = p.id
       where p.name = ${username}`;

    let playerId: number;
    if (!jogador) {
      const [criado] = await conn`
        insert into players (name) values (${username}) returning id`;
      playerId = criado.id;
    } else if (jogador.temConta) {
      console.warn(
        `[migrate] "${username}" está em PLATFORM_ADMIN_USERNAMES, mas já existe um jogador ` +
          `com esse nome e outra conta. Nenhuma conta criada — resolva pelo painel.`,
      );
      continue;
    } else {
      playerId = jogador.id;
    }

    const token = randomBytes(32).toString("base64url");
    const senhaDescartada = await hashPassword(randomBytes(32).toString("base64url"));
    // Num commit só: conta sem convite deixaria o username reservado e sem dono
    // possível, e convite sem conta reabriria a janela que isto veio fechar.
    await conn.begin(async (tx) => {
      await tx`
        insert into users (player_id, username, password_hash, is_platform_admin)
        values (${playerId}, ${username}, ${senhaDescartada}, true)`;
      // .toISOString() não é estilo. `expires_at` é `timestamp` SEM timezone, e um
      // Date cru sai daqui declarado como `timestamptz` (o postgres.js infere 1184
      // para Date), então o Postgres converte para a coluna usando o TimeZone da
      // SESSÃO: numa sessão em America/Sao_Paulo o convite nasce expirando 3h mais
      // cedo. A string vai sem tipo declarado e é gravada literalmente — que é o
      // que o drizzle escreve no resto do app (mapToDriverValue = toISOString) e o
      // que ele relê como UTC (mapFromDriverValue concatena "+0000").
      const expiraEm = new Date(Date.now() + INVITE_DURATION_MS).toISOString();
      await tx`
        insert into invites (token, player_id, expires_at)
        values (${token}, ${playerId}, ${expiraEm})`;
    });

    console.log(
      `[migrate] Conta de admin criada para "${username}". Defina a senha em: ` +
        `${siteUrl()}/convite/${token}`,
    );
  }
}

/**
 * Materializa `PLATFORM_ADMIN_USERNAMES` na coluna `is_platform_admin`.
 *
 * A env var já vale sozinha em runtime (ver src/lib/session.ts) — isto aqui é
 * só para a flag aparecer no banco, que é onde as telas leem. Idempotente e
 * aditivo: só liga, nunca desliga, então promover alguém pelo painel não é
 * desfeito pelo build seguinte. Pega o caso de uma conta que já existia quando o
 * username entrou na lista; conta nova quem cria é o provisionarPlatformAdmins.
 *
 * Sem bump em token_version: o papel é lido do banco a cada request (getSession),
 * então a mudança vale no request seguinte sem derrubar a sessão de ninguém.
 */
async function materializarPlatformAdmins(conn: postgres.Sql) {
  const usernames = [...platformAdminsDoAmbiente()];
  if (usernames.length === 0) return;

  const promovidos = await conn`
    update users
       set is_platform_admin = true
     where username in ${conn(usernames)} and is_platform_admin = false
    returning username`;

  if (promovidos.length > 0) {
    console.log(`[migrate] Admin da plataforma: ${promovidos.map((p) => p.username).join(", ")}`);
  }
}

// Pelada anterior a este modelo fica órfã mesmo — não há backfill de dono.
//
// Houve aqui um passo que atribuía as órfãs ao primeiro admin da plataforma,
// gateado por "nenhuma pelada tem criador". O gate não era one-shot de verdade:
// bastava sobrarem só órfãs (todas as com dono apagadas) para o build seguinte
// redistribuir tudo de novo — e este arquivo roda a cada `npm run build`, fora
// do journal do drizzle. O passo também não era necessário: o admin da
// plataforma já administra pelada órfã por regra (ver podeGerenciarPelada em
// src/lib/permissions.ts), e /admin/peladas rotula e conta as órfãs. Dono
// inventado só apagaria essa informação.

main().catch((error) => {
  console.error("[migrate] Falha ao aplicar migrations:", error);
  process.exit(1);
});
