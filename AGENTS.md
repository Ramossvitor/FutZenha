<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Regras do projeto

## Testes e verificação

Três camadas, da mais barata à mais cara — PR só entra com o check "Verificação / Gate de qualidade" do `ci.yml` verde (a MESMA verificação gateia o deploy):

- `npm test` — unit (vitest, sem banco). Arquivos `*.test.ts` ao lado do módulo.
- `npm run test:integration` — integração com banco real (`*.integration.test.ts`; precisa de `docker compose up -d`; o global-setup cria `futzenha_test` na porta 5433 e aplica as migrations sozinho). Harness em `src/test/` (fixtures, cookie-store fake, mocks de `next/*`).
- `npm run e2e` — smokes Playwright contra o build real (`npx next build` antes; o global-setup cria, migra e semeia `futzenha_e2e` sozinho).

**Nenhuma das três camadas toca o banco de desenvolvimento.** Unit aponta para uma porta discard inerte; integração usa `futzenha_test`; E2E usa `futzenha_e2e`. As travas moram no `src/test/db-url.mts` (só localhost + sufixo obrigatório no nome do banco) e no `src/db/seed.ts` (só localhost, nunca sob `VERCEL`). Não rode `npm run seed` para o E2E — ele apaga todas as tabelas do banco para onde a `DATABASE_URL` apontar.

`npm run test:coverage` roda unit + integração com cobertura (threshold no `vitest.config.mts`).

Regras que os testes seguem: timestamps retroativos via `sql\`now() - interval\`` do Postgres (nunca `new Date()` em SQL cru); e-mails de fixture `@example.com` — exceção única: a canonicalização de ponto e `+tag` só existe no Gmail, então o teste dela usa `@gmail.com` com local part `futzenha.fixture.*`, que ninguém registraria; **`RESEND_API_KEY` ausente em teste/E2E/CI é por design** — a ausência da key é o kill switch do envio real de e-mail, e o setup de integração aborta se ela existir.

## Commits

Não faça commits (nem `git commit`, `git push`, `git merge`, `git rebase`) a menos que o usuário peça explicitamente. Ao terminar uma tarefa, deixe as alterações no working tree e apenas relate o que foi alterado.

## Branches

Implementações não devem ser feitas diretamente no branch default (`main`), salvo pedido explícito do usuário. Se a tarefa envolve alterar código e o usuário não disse para trabalhar na `main`:

1. Antes de editar, proponha o nome do branch a ser criado (ex.: `feat/nome-da-tarefa`, `fix/nome-do-bug`).
2. Inclua a criação do branch como primeiro passo do plano.
3. Só comece a implementar depois que o usuário aprovar o plano/branch.
