import path from "node:path";
import { defineConfig } from "vitest/config";
// Com extensão e apontando para o .mts: é o que o carregador nativo do Vite
// (default numa major futura) exige — sem isso ele avisa em todo `npm test`.
import { resolverUrlDeTeste } from "./src/test/db-url.mts";

const raiz = import.meta.dirname;

// O alias de "server-only" troca o pacote real (que lança fora do react-server)
// por um módulo vazio — é o que deixa os testes importarem módulos de servidor.
const alias = {
  "@": path.resolve(raiz, "src"),
  "server-only": path.resolve(raiz, "src/test/stubs/server-only.ts"),
};

export default defineConfig({
  test: {
    // Mede a LÓGICA (lib, db, actions) — .tsx de página/componente fica de fora
    // porque só o E2E os exercita, e contá-los diluiria o número sem informar.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        "src/test/**",
        "src/**/*.tsx",
        // Mesma razão da linha acima, só que a extensão não entrega: estes são
        // `"use client"` puro (navigator/window/localStorage, useRouter) e só o
        // E2E os exercita. Contá-los diluiria o número sem informar — o que as
        // partes testáveis deles têm (snoozeVigente, urlBase64ToUint8Array,
        // suporteDoBrowser, puxada.ts) está coberto em *.test.ts ao lado.
        "src/components/push/ambiente.ts",
        "src/components/push/use-push.ts",
        "src/components/shell/use-atualizacao.ts",
        "src/app/**/*.css",
        "src/db/seed.ts",
        "src/db/migrate.ts",
        "src/db/preparar-e2e.ts",
      ],
      reporter: ["text-summary", "json-summary", "html"],
      // Baseline medida em 2026-08-21 (unit + integração, 1367 testes): 76,3%
      // de linhas, 74,1% de statements. O threshold trava ~5 pontos abaixo:
      // regressão de cobertura quebra o CI, flutuação normal não. Suba os
      // números conforme a cobertura crescer — nunca abaixe sem conversa.
      //
      // A medida anterior (2026-08-09, 460 testes) era 53,9% / 52,3%, com o
      // threshold em 48/47. O salto veio da zenha: a loja, a carteira e o
      // multiplicador chegaram com suíte própria, e as actions da economia
      // ganharam teste de fronteira.
      thresholds: {
        lines: 71,
        statements: 69,
      },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
          env: {
            // Inerte de propósito: src/db/index.ts lança no import sem a env, o
            // que impediria testar até as funções PURAS de módulos que importam
            // @/db (ex.: mereceAviso em presenca.ts). A porta 9 (discard) não
            // roteia — se um teste unit tentar uma query de verdade, falha na
            // hora em vez de acertar o banco de dev.
            DATABASE_URL: "postgres://unit:unit@127.0.0.1:9/unit_sem_banco",
          },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          setupFiles: ["src/test/setup-integration.ts"],
          globalSetup: ["src/test/global-setup.ts"],
          // Todos os arquivos batem no mesmo banco e o truncate roda entre
          // testes — paralelismo entre arquivos viraria corrida de dados.
          fileParallelism: false,
          env: {
            // Pelo resolverUrlDeTeste, e não por process.env cru: é a MESMA URL
            // que o global-setup usa para criar e migrar o banco, e as travas de
            // localhost e sufixo _test moram lá. Duplicar o literal aqui deixaria
            // o setup migrando um banco e os testes conectando em outro.
            DATABASE_URL: resolverUrlDeTeste(),
            SESSION_SECRET: "segredo-de-teste-nao-usado-em-producao",
            // A pausa anti-rate-limit do lote de resumo (ver email-resumo.ts).
            // Zerada aqui porque o Resend do teste é um `vi.fn()`: seis envios
            // custariam 2,5s de setTimeout real por teste, contra o testTimeout
            // de 5s, e o que estaria sendo medido era o relógio.
            RESUMO_ESPERA_MS: "0",
          },
        },
      },
    ],
  },
});
