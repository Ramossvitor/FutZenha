import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// A identidade visual mora em tokens (src/app/globals.css). Uma cor crua do
// Tailwind ou uma variante `dark:` que escape volta a criar o problema que a
// reescrita resolveu: 38 arquivos decidindo cor por conta própria, e um tema
// claro que só funciona onde alguém lembrou de escrever o par.
//
// A regra é sintática de propósito — pega no `npm run lint`, antes do review.
const PALETA_CRUA =
  "(neutral|gray|zinc|slate|stone|emerald|green|lime|red|rose|orange|amber|yellow|sky|blue|indigo|violet|purple|pink|teal|cyan)";
const PREFIXO = "(bg|text|border|ring|outline|from|to|via|divide|fill|stroke|accent|caret|shadow)";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    files: ["src/**/*.tsx", "src/**/*.ts"],
    rules: {
      // Import não usado é sobra de migração — vira erro para não acumular.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/\\b${PREFIXO}-${PALETA_CRUA}-(50|[1-9]00|950)\\b/]`,
          message:
            "Cor crua do Tailwind. Use os tokens semânticos (bg-surface, text-fg-2, border-line, bg-accent, text-danger-ink…) — eles trocam com o tema sozinhos.",
        },
        {
          selector: `TemplateElement[value.raw=/\\b${PREFIXO}-${PALETA_CRUA}-(50|[1-9]00|950)\\b/]`,
          message:
            "Cor crua do Tailwind num template. Use os tokens semânticos de src/app/globals.css.",
        },
        {
          selector: "Literal[value=/\\bdark:/]",
          message:
            "Variante `dark:` não é mais necessária: os tokens já trocam de valor com o tema. Se um token está faltando, crie-o em globals.css.",
        },
        {
          selector: "TemplateElement[value.raw=/\\bdark:/]",
          message: "Variante `dark:` não é mais necessária — use os tokens de globals.css.",
        },
      ],
    },
  },

  {
    // O botão do Google carrega as cores de marca dele, que as diretrizes do
    // Google não deixam restilizar. É a única exceção do app.
    files: ["src/components/ui/google-button.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },

  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Saída gerada de teste/cobertura (gitignored, mas o eslint varre o disco):
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
