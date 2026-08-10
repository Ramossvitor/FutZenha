// Resolve a URL do banco de TESTE — o da integração (futzenha_test) e o do E2E
// (futzenha_e2e). Nenhum dos dois é o banco de desenvolvimento: as duas suítes
// apagam tudo o que encontram, então rodar teste não pode custar o seu dev.
//
// Consumido por vitest.config.mts, src/test/global-setup.ts (integração) e
// playwright.config.ts + e2e/global-setup.ts (E2E).

export const URL_PADRAO_DE_TESTE = "postgres://futzenha:futzenha@localhost:5433/futzenha_test";
export const URL_PADRAO_DE_E2E = "postgres://futzenha:futzenha@localhost:5433/futzenha_e2e";

// Só localhost: mesmo espírito da trava do src/db/seed.ts — uma URL de teste
// apontada para o Neon de produção apagaria dados reais.
const HOSTS_PERMITIDOS = new Set(["localhost", "127.0.0.1", "::1"]);

type Banco = {
  /** Env var que sobrescreve o padrão. Entra nas mensagens de erro. */
  env: "TEST_DATABASE_URL" | "E2E_DATABASE_URL";
  padrao: string;
  sufixo: string;
  /** O que esta suíte faz com os dados — o erro precisa dizer o que está em jogo. */
  destroi: string;
};

const INTEGRACAO: Banco = {
  env: "TEST_DATABASE_URL",
  padrao: URL_PADRAO_DE_TESTE,
  sufixo: "_test",
  destroi: "O beforeEach da integração trunca TODAS as tabelas",
};

const E2E: Banco = {
  env: "E2E_DATABASE_URL",
  padrao: URL_PADRAO_DE_E2E,
  sufixo: "_e2e",
  destroi: "A preparação do E2E roda o seed, que APAGA todas as tabelas",
};

// O host sozinho não basta. O erro que realmente acontece não é apontar para o
// Neon — é copiar a DATABASE_URL do .env ao criar a variável de teste, e aí o
// host passa na trava enquanto o banco de DESENVOLVIMENTO é apagado. O sufixo
// no nome do banco é a segunda metade da mesma proteção.
function resolver({ env, padrao, sufixo, destroi }: Banco): string {
  const url = process.env[env] ?? padrao;
  const { hostname, pathname } = new URL(url);
  if (!HOSTS_PERMITIDOS.has(hostname)) {
    throw new Error(
      `${env} aponta para "${hostname}" — testes só rodam contra localhost, ` +
        "nunca contra um banco remoto.",
    );
  }
  const banco = pathname.slice(1);
  if (!banco.endsWith(sufixo)) {
    throw new Error(
      `${env} aponta para o banco "${banco}", e o nome precisa terminar em ` +
        `"${sufixo}". ${destroi} — com a URL do banco de desenvolvimento aqui, ` +
        "ele apagaria o seu banco de dev.",
    );
  }
  return url;
}

export function resolverUrlDeTeste(): string {
  return resolver(INTEGRACAO);
}

export function resolverUrlDeE2E(): string {
  return resolver(E2E);
}
