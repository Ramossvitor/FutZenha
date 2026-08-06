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
| `npm test` | Testes (nota, companheiros, anonimato, quórum, sorteio, sessão, senha) |
| `npm run db:generate` | Gera migration a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrations no banco do `DATABASE_URL` |
| `npm run db:migrate:prod` | Aplica migrations usando a connection string direta (conserto manual) |
| `npm run db:studio` | UI para inspecionar o banco |
| `npm run seed` | **Apaga tudo** e repopula com dados de exemplo (só banco local) |

## Fluxo de uma pelada

1. Admin cria a pelada em `/admin/peladas` (data, hora, local).
2. O link público (`/pelada/[id]`) vai no grupo do WhatsApp; cada um entra na conta e marca **Vou / Fora** (só a própria presença — o admin também pode marcar por alguém no painel).
3. No dia, o admin sorteia os times (balanceado por nota, goleiros separados) e ajusta manualmente se quiser.
4. Durante/depois, o admin lança os jogos, placares e gols.
5. **Conferir escalação e encerrar**: o admin revisa quem jogou em qual time, jogo a jogo, e confirma. Isso trava a pelada, faz os números contarem na artilharia, nos rankings e na presença, e **abre a rodada de avaliação**.

### Depois de encerrar

A escalação confirmada é **imutável** — é ela que define quem avalia quem, e mexer nela invalidaria avaliações já enviadas. Placar e gols ainda podem ser corrigidos por **24h**. Passado isso, a única forma de mexer numa pelada é **excluí-la**, o que exige votação (ver abaixo). Não existe "reabrir pelada".

## Avaliação entre companheiros

A nota do jogador é **100% calculada** — o admin não digita mais. Todo mundo começa em **5,0**.

1. Encerrada a pelada, cada jogador com conta recebe uma notificação e tem **2 dias** para dar de 1 a 5 estrelas aos companheiros com quem dividiu o lado em algum jogo daquele dia.
2. A rodada é apurada quando **todos avaliam** ou quando o prazo vence — o que vier primeiro.
3. As estrelas viram nota numa escala linear (1★ = 1,0 · 2★ = 3,25 · 3★ = 5,5 · 4★ = 7,75 · 5★ = 10,0), e a nota nova é `(2 × nota atual + média recebida) / 3`. Ou seja, uma pelada pesa **1/3**.
4. Todo mundo é notificado da mudança, e a nota nova aparece em `/rankings` e no perfil.

Detalhes que valem conhecer:

- **A nota é sempre recalculada do zero**, desde 5,0, a partir das avaliações que ainda valem. Não existe delta acumulado — é isso que faz descartar uma avaliação ou apagar uma pelada funcionarem sem código de desfazimento.
- A ordem do replay é a **data das peladas**, nunca a data de apuração: a nota é função das avaliações, não de quando o admin clicou.
- 10,0 e 1,0 só são alcançáveis com unanimidade sustentada (~10 peladas seguidas), e uma única avaliação fora do padrão já tira o jogador do extremo.
- Quem tem convite pendente **joga normalmente** (presença, gols, escalação), mas não entra nos rankings e não avalia nem é avaliado. Ao resgatar o acesso, todo o histórico dele aparece de uma vez — a nota, porém, começa em 5,0: não há avaliação retroativa.

### Nota injusta

O jogador vê no perfil cada estrela que recebeu, **sem saber quem deu**, e pode reportar uma delas ao admin em até 2 dias após a apuração (a partir de 2 avaliações recebidas). O admin tem 3 dias para decidir em `/admin/avaliacoes`; **se não responder, a denúncia é aceita automaticamente**. Descartar uma avaliação recalcula a nota de todo mundo daquela pelada em diante.

O anonimato tem um cuidado que não é óbvio: `ratings.id` é sequencial, então expor o id entregaria a ordem de envio. A tela trabalha com a **posição** na lista (ordenada por nota, com desempate por hash), e o id nunca sai do servidor.

### Excluir uma pelada

Pelada **não encerrada** o admin apaga direto. Pelada **encerrada** exige votação: o admin abre com justificativa, e passa com **85% de SIM em 48h** entre quem jogou e tem conta. Não votar conta como **contra**, o voto é **definitivo**, e há **uma votação por pelada** — rejeitada, ela fica no histórico para sempre. Aprovada, a pelada é apagada com tudo que gerou e as notas são recalculadas.

## Contas de jogador

- **Criar conta**: em `/admin/jogadores`, o admin clica em **Gerar convite** e manda o link no WhatsApp do jogador. O link (`/convite/[token]`) vale 7 dias e é de uso único; o jogador escolhe usuário e senha e já sai logado. Nada é consumido ao abrir o link — só ao enviar o formulário (bots de preview do WhatsApp não estragam o convite).
- **Esqueceu a senha**: o admin clica em **Resetar senha (novo convite)** no mesmo lugar — o link redefine a senha, derruba as sessões antigas e reativa a conta se estava desativada.
- **Desativar conta**: derruba a sessão do jogador no próximo acesso (a conta some sem apagar histórico; desativar o *jogador* é outra coisa — tira das listas mas a conta continua entrando).
- **Meu perfil** (`/perfil`): nota atual, estatísticas próprias (só peladas encerradas), as estrelas recebidas em cada rodada e troca de senha.
- Cadastrar um jogador **já gera o convite** — ninguém nasce sem acesso a caminho.
- Logins de exemplo do seed: `du`, `ps` e `cadu`, todos com `senha123` (+ um convite pendente impresso no console do seed).
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
   - `CRON_SECRET` — protege `/api/cron/pendencias`, que fecha as rodadas de avaliação vencidas. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Sem ela a rota responde 503 (nunca "libera tudo"), e os prazos passam a depender só do acesso ao site.
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

`players` → `attendances` ← `match_days` → `teams` → `team_players`; `games` (time A × time B com placar) → `goals` (autor + quantidade) e `game_players` (quem jogou de qual lado **naquele jogo**). O placar digitado não precisa bater com a soma dos gols — cobre gol contra e gol sem autor lembrado.

`game_players` é a fonte de verdade de quem jogou: `teams` guarda só o colete da pelada. É dela que saem o V/E/D e os "companheiros" da avaliação.

Avaliação: `rating_rounds` (uma por pelada) → `rating_round_raters` (o denominador congelado de quem deve avaliar) e `ratings` (`discarded_at` nulo = vale) → `rating_reports`. `skill_history` é **projeção** do replay, reescrita inteira a cada recálculo. `notifications` tem unique em `(player_id, dedupe_key)`, o que torna notificar idempotente.

Exclusão por votação: `match_day_deletion_votes` (uma por pelada) → `match_day_deletion_voters` (eleitorado congelado + o voto).

Estatísticas são derivadas por query (`src/lib/stats.ts`), contando só peladas encerradas e só jogadores com conta ativa.

### Prazos e o varredor

Prazos são timestamps absolutos gravados na criação, comparados sempre com o `now()` do Postgres. Quem os aplica é `processarPendencias()` (`src/lib/pendencias.ts`), disparado pelo `after()` no layout (no máximo 1× por minuto por instância) e por `GET /api/cron/pendencias` como rede de segurança — protegido por `CRON_SECRET` e agendado no `vercel.json`. É idempotente: cada transição é `UPDATE ... WHERE status = 'open' RETURNING` e o replay recalcula do zero.

## Roadmap (fase 2)

- Feed iCalendar (`/api/calendar.ics`) para assinar a agenda no Google/Apple Calendar
- Admin de evento (hoje o admin é global, uma senha só)
- Defesa contra conluio na avaliação — a denúncia só cobre nota injustamente baixa
- Convidados avulsos, "craque da noite", caixinha do grupo, streaks/badges
