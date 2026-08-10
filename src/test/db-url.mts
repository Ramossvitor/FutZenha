// Resolve a URL do banco de TESTE (compartilhada entre vitest.config.mts e o
// global-setup). Só aceita localhost: o mesmo espírito da trava do seed — um
// TEST_DATABASE_URL apontado para o Neon de produção truncaria dados reais.

export const URL_PADRAO_DE_TESTE = "postgres://futzenha:futzenha@localhost:5433/futzenha_test";

const HOSTS_PERMITIDOS = new Set(["localhost", "127.0.0.1", "::1"]);

// O host sozinho não basta. O erro que realmente acontece não é apontar para o
// Neon — é copiar a DATABASE_URL do .env ao criar a TEST_DATABASE_URL, e aí o
// host passa na trava enquanto o beforeEach trunca o banco de DESENVOLVIMENTO.
// O sufixo é a segunda metade da mesma proteção.
const SUFIXO_OBRIGATORIO = "_test";

export function resolverUrlDeTeste(): string {
  const url = process.env.TEST_DATABASE_URL ?? URL_PADRAO_DE_TESTE;
  const { hostname, pathname } = new URL(url);
  if (!HOSTS_PERMITIDOS.has(hostname)) {
    throw new Error(
      `TEST_DATABASE_URL aponta para "${hostname}" — testes só rodam contra localhost, ` +
        "nunca contra um banco remoto.",
    );
  }
  const banco = pathname.slice(1);
  if (!banco.endsWith(SUFIXO_OBRIGATORIO)) {
    throw new Error(
      `TEST_DATABASE_URL aponta para o banco "${banco}", e o nome precisa terminar em ` +
        `"${SUFIXO_OBRIGATORIO}". O beforeEach da integração trunca TODAS as tabelas — ` +
        "com a URL do banco de desenvolvimento aqui, ele apagaria o seu banco de dev.",
    );
  }
  return url;
}
