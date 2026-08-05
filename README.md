# ⚽ FutZenha

Site para organizar a pelada semanal do grupo: confirmação de presença, sorteio de times balanceado, resultados, artilharia e rankings.

**Modelo de uso:** cada jogador tem uma conta (criada via link de convite que o admin manda no WhatsApp) e marca **apenas a própria presença**. As páginas continuam públicas para consulta; quem ainda não tem conta é marcado pelo admin no painel `/admin`. Sem e-mail, sem serviço externo — o convite é o único canal de cadastro e também serve de reset de senha.

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS v4
- Postgres com [Drizzle ORM](https://orm.drizzle.team) (local via Docker; produção no [Neon](https://neon.tech) free tier)
- Auth sem provider externo: cookie assinado (HMAC) com papel admin/jogador; admin entra com senha única em env var, jogadores com usuário + senha (hash scrypt do `node:crypto`)
- Deploy: [Vercel](https://vercel.com) (plano Hobby)

## Rodando local

Pré-requisitos: Node 22 (ver `.nvmrc`), Docker.

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
| `npm run build` | Aplica migrations pendentes e faz o build (com type-check) |
| `npm test` | Testes (sorteio, sessão, senha) |
| `npm run db:generate` | Gera migration a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrations no banco do `DATABASE_URL` |
| `npm run db:migrate:prod` | Aplica migrations usando a connection string direta (conserto manual) |
| `npm run db:studio` | UI para inspecionar o banco |
| `npm run seed` | **Apaga tudo** e repopula com dados de exemplo (só banco local) |

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

Vercel Hobby + Neon free, com deploy contínuo: **`git push` na `main` aplica as migrations e publica**.

### Primeira vez

> Não crie a env var `DATABASE_URL` à mão — a integração do Neon precisa desse nome livre para injetar.

1. **Banco**: vercel.com → **Storage** → **Create Database** → **Neon** → plano Free → nome `futzenha-db`. Deixe o branching de preview desligado.
2. **Projeto**: **Add New… → Project** → importe este repo (framework Next.js detectado). Antes de dar Deploy, adicione em Environment Variables:
   - `SESSION_SECRET` — gere com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
   - `ADMIN_PASSWORD` — a senha do painel
3. **O primeiro build falha de propósito** (`[migrate] Nenhuma connection string encontrada`): a Vercel só deixa conectar o banco depois que o projeto existe.
4. **Conectar o banco**: Project → **Storage** → **Connect Database** → `futzenha-db`, marcando Production, Preview e Development. Isso injeta `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` e as `PG*`.
5. **Redeploy** pelo painel. O log deve mostrar `[migrate] Migrations aplicadas.`
6. Entre em `/admin`, cadastre os jogadores reais e mande os convites. **Nunca rode o seed em produção** (ele apaga tudo — e há uma trava que impede isso).

`NEXT_PUBLIC_SITE_URL` não precisa ser configurada: `src/lib/site-url.ts` deriva o domínio das env vars da própria Vercel. Só defina se quiser forçar um domínio próprio.

### Lançando atualizações

- **Só código**: commit e `git push origin main`. A Vercel builda e publica.
- **Mudança de schema**: edite `src/db/schema.ts` → `npm run db:generate` → **leia o SQL gerado** → `npm run db:migrate` no banco local e teste → commit incluindo `schema.ts` **e** a pasta `drizzle/` inteira → `git push`. Nunca edite uma migration já enviada; gere uma nova.
- **Previews de branch** buildam mas **não migram**, e apontam para o mesmo banco de produção: dado criado num preview é dado real, e um preview com schema novo quebra em runtime. Teste mudança de schema no Docker local.

Limites esperados do free tier: o Neon dorme após ~5 min sem uso, então a primeira visita do dia leva 1–3s a mais.

## Modelo de dados (resumo)

`players` → `attendances` ← `match_days` → `teams` → `team_players`; `games` (time A × time B com placar) → `goals` (autor + quantidade). O placar digitado não precisa bater com a soma dos gols — cobre gol contra e gol sem autor lembrado. Estatísticas são derivadas por query (`src/lib/stats.ts`), contando só peladas encerradas.

## Roadmap (fase 2)

- Feed iCalendar (`/api/calendar.ics`) para assinar a agenda no Google/Apple Calendar
- Nota sugerida pelo histórico (aproveitamento + gols recentes) como apoio ao sorteio
- Convidados avulsos, "craque da noite", caixinha do grupo, streaks/badges
