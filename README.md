# ⚽ FutZenha

Site para organizar a pelada semanal do grupo: confirmação de presença, sorteio de times balanceado, resultados, artilharia e rankings.

**Modelo de uso:** cada jogador tem uma conta (criada via link de convite que o admin manda no WhatsApp) e marca **apenas a própria presença**. As páginas continuam públicas para consulta; quem ainda não tem conta é marcado pelo admin no painel `/admin`. Sem e-mail, sem serviço externo — o convite é o único canal de cadastro e também serve de reset de senha.

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS v4
- Postgres com [Drizzle ORM](https://orm.drizzle.team) (local via Docker; produção no [Neon](https://neon.tech) free tier)
- Auth sem provider externo: cookie assinado (HMAC) com papel admin/jogador; admin entra com senha única em env var, jogadores com usuário + senha (hash scrypt do `node:crypto`)
- Deploy: [Vercel](https://vercel.com) (plano Hobby)

## Rodando local

Pré-requisitos: Node 20+, Docker.

```bash
# 1. Banco local (Postgres na porta 5433)
docker compose up -d

# 2. Env vars
cp .env.example .env   # e edite ADMIN_PASSWORD / SESSION_SECRET

# 3. Dependências + migrations + dados de exemplo
npm install
npm run db:migrate
npm run seed

# 4. Dev server
npm run dev
```

Acesse http://localhost:3000 — o painel fica em `/admin` (senha = `ADMIN_PASSWORD` do `.env`).

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Build de produção (roda type-check) |
| `npm test` | Testes (algoritmo de sorteio) |
| `npm run db:generate` | Gera migration a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrations no banco do `DATABASE_URL` |
| `npm run db:studio` | UI para inspecionar o banco |
| `npm run seed` | **Apaga tudo** e repopula com dados de exemplo |

## Fluxo de uma pelada

1. Admin cria a pelada em `/admin/peladas` (data, hora, local).
2. O link público (`/pelada/[id]`) vai no grupo do WhatsApp; cada um entra na conta e marca **Vou / Fora** (só a própria presença — quem não tem conta pede convite ao admin ou é marcado por ele no painel).
3. No dia, o admin sorteia os times (balanceado por nota, goleiros separados) e ajusta manualmente se quiser.
4. Durante/depois, o admin lança os jogos, placares e gols.
5. **Encerrar pelada** trava tudo e faz os números contarem na artilharia, nos rankings e na presença.

Notas dos jogadores (1–10) só aparecem no admin — nunca nas páginas públicas nem no perfil.

## Contas de jogador

- **Criar conta**: em `/admin/jogadores`, o admin clica em **Gerar convite** e manda o link no WhatsApp do jogador. O link (`/convite/[token]`) vale 7 dias e é de uso único; o jogador escolhe usuário e senha e já sai logado. Nada é consumido ao abrir o link — só ao enviar o formulário (bots de preview do WhatsApp não estragam o convite).
- **Esqueceu a senha**: o admin clica em **Resetar senha (novo convite)** no mesmo lugar — o link redefine a senha, derruba as sessões antigas e reativa a conta se estava desativada.
- **Desativar conta**: derruba a sessão do jogador no próximo acesso (a conta some sem apagar histórico; desativar o *jogador* é outra coisa — tira das listas mas a conta continua entrando).
- **Meu perfil** (`/perfil`): estatísticas próprias (só peladas encerradas) e troca de senha.
- Logins de exemplo do seed: `du` / `senha123` e `ps` / `senha123` (+ um convite pendente impresso no console do seed).
- Limitação conhecida: um cookie = um papel por vez. O admin que também joga usa o override de presenças do painel, ou sai e entra com a conta de jogador.
- Sem rate limiting no login, de propósito (grupo fechado; o custo do scrypt já freia força bruta; mais que isso exigiria serviço de estado compartilhado, quebrando o R$ 0).

## Deploy (R$ 0)

1. Crie um banco no [Neon](https://neon.tech). Copie **duas** connection strings: a *pooled* (host com `-pooler`) e a direta.
2. Importe o repo na [Vercel](https://vercel.com) e configure as env vars: `DATABASE_URL` (**a string pooled**), `ADMIN_PASSWORD`, `SESSION_SECRET` (string longa aleatória) e `NEXT_PUBLIC_SITE_URL` (URL final do site — os links de convite usam ela).
3. Como a string pooled passa por PgBouncer em modo transação, adicione `{ prepare: false }` na chamada `postgres(...)` de `src/db/index.ts` na hora do deploy.
4. Rode as migrations no banco de produção usando a string **direta** (sem `-pooler`): `DATABASE_URL=<neon-direta> npm run db:migrate` (localmente, apontando para o Neon).
5. Deploy. Não rode o seed em produção — cadastre os jogadores reais no `/admin/jogadores` e mande os convites.

## Modelo de dados (resumo)

`players` → `attendances` ← `match_days` → `teams` → `team_players`; `games` (time A × time B com placar) → `goals` (autor + quantidade). O placar digitado não precisa bater com a soma dos gols — cobre gol contra e gol sem autor lembrado. Estatísticas são derivadas por query (`src/lib/stats.ts`), contando só peladas encerradas.

## Roadmap (fase 2)

- Feed iCalendar (`/api/calendar.ics`) para assinar a agenda no Google/Apple Calendar
- Nota sugerida pelo histórico (aproveitamento + gols recentes) como apoio ao sorteio
- Convidados avulsos, "craque da noite", caixinha do grupo, streaks/badges
