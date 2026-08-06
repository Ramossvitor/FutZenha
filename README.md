# ⚽ FutZenha

Site para organizar a pelada semanal do grupo: confirmação de presença, sorteio de times balanceado, resultados, artilharia e rankings.

**Modelo de uso:** cada jogador tem uma conta (criada via link de convite entregue no WhatsApp) e marca **apenas a própria presença**. As páginas continuam públicas para consulta. Sem e-mail, sem serviço externo — o convite é o único canal de cadastro e também serve de reset de senha.

**Dois papéis de admin**, e um jogador pode ser os dois:

| | Admin da pelada | Admin da plataforma |
|---|---|---|
| Quem é | quem **criou** aquela pelada | jogador com a flag `is_platform_admin` |
| Onde | `/pelada/[id]/gerenciar` | `/admin` |
| Pode | presenças, sorteio, placar, gols, encerrar, abrir votação de exclusão, cadastrar jogador novo | contas e convites, julgar denúncias de nota injusta, ver o uso do sistema, excluir pelada fabricada — e é fallback em qualquer pelada |

Qualquer jogador logado marca uma pelada em `/peladas/nova` e vira admin **dela**.

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS v4
- Postgres com [Drizzle ORM](https://orm.drizzle.team) (local via Docker; produção no [Neon](https://neon.tech) free tier)
- Auth sem provider externo: cookie assinado (HMAC); todo mundo entra com usuário + senha (hash scrypt do `node:crypto`), e ser admin da plataforma é uma flag na conta
- Deploy: [Vercel](https://vercel.com) (plano Hobby)

## Rodando local

Pré-requisitos: Node 22 (ver `.nvmrc`), Docker.

```bash
# 1. Banco local (Postgres na porta 5433)
docker compose up -d

# 2. Env vars
cp .env.example .env   # e edite SESSION_SECRET / PLATFORM_ADMIN_USERNAMES

# 3. Dependências + migrations + dados de exemplo
npm install
npm run db:migrate
npm run seed

# 4. Dev server
npm run dev
```

O login pelo Google é opcional no local: sem `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` o botão simplesmente não aparece e o `/login` fica só com usuário e senha (que é o que o seed cria). Para ligar, crie um OAuth client em console.cloud.google.com (**APIs & Services → Credentials → OAuth client ID → Web application**), cadastre `http://localhost:3000/api/auth/google/callback` como redirect URI e copie as duas credenciais para o `.env` — o `.env.example` tem as instruções ao lado das vars.

Acesse http://localhost:3000. O seed imprime os logins demo; o primeiro deles é o admin da plataforma e enxerga o painel `/admin`.

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Aplica migrations pendentes e faz o build (com type-check) |
| `npm test` | Testes (nota, companheiros, papéis, anonimato, quórum, sorteio, sessão, senha) |
| `npm run db:generate` | Gera migration a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrations no banco do `DATABASE_URL` |
| `npm run db:migrate:prod` | Aplica migrations usando a connection string direta (conserto manual) |
| `npm run db:studio` | UI para inspecionar o banco |
| `npm run seed` | **Apaga tudo** e repopula com dados de exemplo (só banco local) |

## Fluxo de uma pelada

1. Qualquer jogador logado cria a pelada em `/peladas/nova` (data, hora, local) e vira o **admin dela**.
2. O link público (`/pelada/[id]`) vai no grupo do WhatsApp; cada um entra na conta e marca **Vou / Fora** (só a própria presença). O admin da pelada marca por **quem ainda não tem acesso** e cadastra quem chegou de última hora; quem já tem conta ativa entra e marca sozinho — depois disso o admin também ajusta a presença dessa pessoa. É o que impede alguém de marcar uma pelada e escalar gente que nunca soube do jogo, mexendo na presença e no V/E/D dela.
3. No dia, o admin da pelada sorteia os times (balanceado por nota, goleiros separados) e ajusta manualmente se quiser.
4. Durante/depois, ele lança os jogos, placares e gols.
5. **Conferir escalação e encerrar**: revisa quem jogou em qual time, jogo a jogo, e confirma. Isso trava a pelada, faz os números contarem na artilharia, nos rankings e na presença, e **abre a rodada de avaliação**.

### Depois de encerrar

A escalação confirmada é **imutável** — é ela que define quem avalia quem, e mexer nela invalidaria avaliações já enviadas. Placar e gols ainda podem ser corrigidos por **24h**. Passado isso, a única forma de mexer numa pelada é **excluí-la**, o que exige votação (ver abaixo). Não existe "reabrir pelada".

## Avaliação entre companheiros

A nota do jogador é **100% calculada** — o admin não digita mais. Todo mundo começa em **5,0**.

1. Encerrada a pelada, cada jogador com conta recebe uma notificação e tem **2 dias** para dar de 1 a 5 estrelas aos companheiros com quem dividiu o lado em algum jogo daquele dia. A avaliação só acontece em **grupo de 3 ou mais com conta ativa no mesmo lado** — abaixo disso o time joga e conta para placar, artilharia e presença, mas não mexe em nota nenhuma. É a trava contra nota fabricada: sem ela, duas contas combinadas subiriam de 5,0 a 9,3 em cinco peladas de mentira.
2. A rodada é apurada quando **todos avaliam** ou quando o prazo vence — o que vier primeiro.
3. As estrelas viram nota numa escala linear (1★ = 1,0 · 2★ = 3,25 · 3★ = 5,5 · 4★ = 7,75 · 5★ = 10,0), e a nota nova é `(2 × nota atual + média recebida) / 3`. Ou seja, uma pelada pesa **1/3**.
4. Todo mundo é notificado da mudança, e a nota nova aparece em `/rankings` e no perfil.

Detalhes que valem conhecer:

- **A nota é sempre recalculada do zero**, desde 5,0, a partir das avaliações que ainda valem. Não existe delta acumulado — é isso que faz descartar uma avaliação ou apagar uma pelada funcionarem sem código de desfazimento.
- A ordem do replay é a **data das peladas**, nunca a data de apuração: a nota é função das avaliações, não de quando o admin clicou.
- 10,0 e 1,0 só são alcançáveis com unanimidade sustentada (~10 peladas seguidas), e uma única avaliação fora do padrão já tira o jogador do extremo.
- Quem tem convite pendente **joga normalmente** (presença, gols, escalação), mas não entra nos rankings e não avalia nem é avaliado. Ao resgatar o acesso, todo o histórico dele aparece de uma vez — a nota, porém, começa em 5,0: não há avaliação retroativa.

### Nota injusta

O jogador vê no perfil cada estrela que recebeu, **sem saber quem deu**, e pode reportar uma delas em até 2 dias após a apuração (a partir de 2 avaliações recebidas). Quem julga é o **admin da plataforma**, em `/admin/avaliacoes`, e ele tem 3 dias; **se não responder, a denúncia é aceita automaticamente**. Descartar uma avaliação recalcula a nota de todo mundo daquela pelada em diante.

Julgar denúncia **não** é do admin da pelada, de propósito: ele quase sempre jogou a rodada, então poderia julgar a própria denúncia — e, pior, descobriria de quem partiu a nota contestada. Aceitar uma denúncia também dispara o replay que recalcula a nota de todo mundo, o que é decisão de plataforma, não de pelada.

Quem julga **vê o nome de quem avaliou** — o anonimato é entre jogadores, e para decidir é preciso saber de quem partiu a nota. Por isso a mesma regra vale para o admin da plataforma: **ele não julga denúncia de pelada que jogou**. Ele é jogador como qualquer outro, então sem essa trava bastaria denunciar a própria nota para abrir a lista de quem lhe deu cada estrela. Nessas denúncias ele vê que existem e que o prazo corre, sem os nomes e sem os botões; decide outro admin da plataforma, ou o prazo vence e o auto-aceite resolve.

O anonimato tem um cuidado que não é óbvio: `ratings.id` é sequencial, então expor o id entregaria a ordem de envio. A tela trabalha com a **posição** na lista (ordenada por nota, com desempate por hash), e o id nunca sai do servidor.

### Excluir uma pelada

Pelada **não encerrada** o admin dela apaga direto. Pelada **encerrada** exige votação: o admin da pelada abre com justificativa, e passa com **85% de SIM em 48h** entre quem jogou e tem conta. Não votar conta como **contra**, o voto é **definitivo**, e há **uma votação por pelada** — rejeitada, ela fica no histórico para sempre. Aprovada, a pelada é apagada com tudo que gerou e as notas são recalculadas.

Fora disso, o **admin da plataforma** pode excluir uma pelada direto em `/admin/peladas`, sem votação. É a contrapartida de qualquer um poder criar pelada: contra uma pelada fabricada não adianta votação, porque quem votaria são os "jogadores" dela. A tela mostra quem criou cada pelada, quantos jogaram e quantos tinham conta ativa — que é o que denuncia fabricação. Como a exclusão é unilateral e irreversível, o motivo escrito é obrigatório e vai para o log do servidor junto com quem apertou o botão.

Enquanto a votação corre, quem propôs vê só **quantos** faltam votar — não o placar parcial nem os nomes. Com os dois, bastava recarregar antes e depois de alguém votar para saber como aquela pessoa votou, num voto que é definitivo.

## Contas de jogador

- **Criar conta**: em `/admin/jogadores`, o admin da plataforma clica em **Gerar convite** e manda o link no WhatsApp do jogador. O admin de uma pelada também cadastra gente nova pela própria tela de gestão, e o link do convite aparece ali mesmo, em **Convites para entregar** — só de quem ainda não tem conta, porque convite para quem já tem é reset de acesso e isso é da plataforma. O link (`/convite/[token]`) vale 7 dias e é de uso único. Nada é consumido ao abrir o link — só ao resgatar de verdade (bots de preview do WhatsApp não estragam o convite).
- **Convite com e-mail = convite de Google**: preenchendo o campo **E-mail (conta Google)** ao gerar o convite, o link só é resgatado por *aquela* conta Google — o formulário de usuário e senha nem aparece. É o que impede quem pegou o link no grupo de virar conta: o token sozinho não basta. Deixando o campo vazio, o convite segue no fluxo antigo, em que o jogador escolhe usuário e senha. Errou o e-mail? Revogue e gere outro; o convite trava no endereço digitado.
- **Entrar pelo Google**: quem tem conta Google vinculada entra pelo botão no `/login`. Quem já tinha usuário e senha vincula a própria conta em `/perfil` → **Conectar conta Google** (isso encerra as sessões nos outros aparelhos, como uma troca de senha). Conta nascida pelo Google não tem senha, e por isso não mostra "Trocar senha" no perfil. A identidade guardada é o `sub` do Google, não o e-mail: trocar de endereço não perde a conta.
- **Esqueceu a senha**: o admin da plataforma clica em **Resetar acesso (novo convite)** no mesmo lugar — o link redefine o acesso, derruba as sessões antigas e reativa a conta se estava desativada.
- **Desativar conta**: derruba a sessão do jogador no próximo acesso (a conta some sem apagar histórico; desativar o *jogador* é outra coisa — tira das listas mas a conta continua entrando).
- **Meu perfil** (`/perfil`): nota atual, estatísticas próprias (só peladas encerradas), as estrelas recebidas em cada rodada e troca de senha.
- Cadastrar um jogador **já gera o convite** — ninguém nasce sem acesso a caminho.
- Logins de exemplo do seed: quatro contas com `senha123`, impressas no console (a primeira é o admin da plataforma) + um convite pendente.
- **Admin da plataforma**: `PLATFORM_ADMIN_USERNAMES` (lista por vírgula) vale como chave-mestra em runtime **e** liga a flag `users.is_platform_admin` a cada build. É o que impede ficar trancado do lado de fora de um banco sem shell. O build também **cria a conta** de quem está na lista e ainda não existe, imprimindo o link para definir a senha — é assim que nasce o primeiro admin de uma instalação nova. Esses usernames ficam **reservados**: ninguém consegue escolhê-los ao resgatar um convite, senão bastaria digitar o nome certo para sair admin.
- **Promover e rebaixar**: em `/admin/jogadores` dá para tornar outra conta admin da plataforma, ou tirar o papel. Mexer nisso encerra a sessão em curso da pessoa (`token_version + 1`). Ninguém se rebaixa sozinho, e quem está em `PLATFORM_ADMIN_USERNAMES` continua admin de qualquer jeito — a env var vence o banco.
- Sem rate limiting no login, de propósito (grupo fechado; o custo do scrypt já freia força bruta; mais que isso exigiria serviço de estado compartilhado, quebrando o R$ 0).

## Deploy (R$ 0)

Vercel Hobby + Neon free, com deploy contínuo: **`git push` na `main` aplica as migrations e publica**.

### Primeira vez

> Não crie a env var `DATABASE_URL` à mão — a integração do Neon precisa desse nome livre para injetar.

1. **Banco**: vercel.com → **Storage** → **Create Database** → **Neon** → plano Free → nome `futzenha-db`. Deixe o branching de preview desligado.
2. **Projeto**: **Add New… → Project** → importe este repo (framework Next.js detectado). Antes de dar Deploy, adicione em Environment Variables:
   - `SESSION_SECRET` — gere com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
   - `PLATFORM_ADMIN_USERNAMES` — o(s) username(s) do admin da plataforma, separados por vírgula
   - `CRON_SECRET` — protege `/api/cron/pendencias`, que fecha as rodadas de avaliação vencidas. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Sem ela a rota responde 503 (nunca "libera tudo"), e os prazos passam a depender só do acesso ao site.
   - `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` — opcionais, mas sem as duas o botão "Entrar com o Google" some e só resta usuário e senha (ver o passo 7). Peça apenas os escopos `openid`/`email`/`profile`: são não-sensíveis, dispensam a verificação do Google e é por isso que o login sai de graça.
3. **O primeiro build falha de propósito** (`[migrate] Nenhuma connection string encontrada`): a Vercel só deixa conectar o banco depois que o projeto existe.
4. **Conectar o banco**: Project → **Storage** → **Connect Database** → `futzenha-db`, marcando Production, Preview e Development. Isso injeta `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` e as `PG*`.
5. **Redeploy** pelo painel. O log deve mostrar `[migrate] Migrations aplicadas.`
6. **Pegue o link do primeiro admin no log do build**: como não existe mais senha de admin, o `migrate` cria a conta de quem está em `PLATFORM_ADMIN_USERNAMES` e imprime `[migrate] Conta de admin criada para "…". Defina a senha em: https://…/convite/<token>`. Abra o link, escolha a senha, e você entra como admin da plataforma. Depois vá em `/admin`, cadastre os jogadores reais e mande os convites. **Nunca rode o seed em produção** (ele apaga tudo — e há uma trava que impede isso).
7. **Login pelo Google** (opcional, e só depois de o domínio existir): em console.cloud.google.com → **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**, cadastre como **Authorized redirect URI** exatamente `https://SEU-DOMINIO/api/auth/google/callback` (e `http://localhost:3000/api/auth/google/callback` se for usar no local). O Google confere essa URI byte a byte, duas vezes — na ida e na troca do code —, então um `/` sobrando já reprova. Copie o client ID e o secret para as env vars do passo 2 e redeploy.

`NEXT_PUBLIC_SITE_URL` não precisa ser configurada: `src/lib/site-url.ts` deriva o domínio das env vars da própria Vercel, preferindo o domínio **de produção** (estável) à URL única do deploy. É desse valor que sai a redirect URI do Google — o que também explica por que o login pelo Google não funciona em preview: lá a URL muda a cada publicação e nunca vai bater com a cadastrada. Defina a var se quiser forçar um domínio próprio.

### Lançando atualizações

- **Só código**: commit e `git push origin main`. A Vercel builda e publica.
- **Mudança de schema**: edite `src/db/schema.ts` → `npm run db:generate` → **leia o SQL gerado** → `npm run db:migrate` no banco local e teste → commit incluindo `schema.ts` **e** a pasta `drizzle/` inteira → `git push`. Nunca edite uma migration já enviada; gere uma nova.
- **Previews de branch** buildam mas **não migram**, e apontam para o mesmo banco de produção: dado criado num preview é dado real, e um preview com schema novo quebra em runtime. Teste mudança de schema no Docker local.

Limites esperados do free tier: o Neon dorme após ~5 min sem uso, então a primeira visita do dia leva 1–3s a mais.

## Modelo de dados (resumo)

`players` → `attendances` ← `match_days` (com `created_by_player_id` = o admin daquela pelada; nulo = órfã — anterior a este modelo ou de criador apagado — e só a plataforma administra, sem dono inventado por backfill) → `teams` → `team_players`; `games` (time A × time B com placar) → `goals` (autor + quantidade) e `game_players` (quem jogou de qual lado **naquele jogo**). O placar digitado não precisa bater com a soma dos gols — cobre gol contra e gol sem autor lembrado.

`game_players` é a fonte de verdade de quem jogou: `teams` guarda só o colete da pelada. É dela que saem o V/E/D e os "companheiros" da avaliação.

Avaliação: `rating_rounds` (uma por pelada) → `rating_round_raters` (o denominador congelado de quem deve avaliar) e `ratings` (`discarded_at` nulo = vale) → `rating_reports`. `skill_history` é **projeção** do replay, reescrita inteira a cada recálculo. `notifications` tem unique em `(player_id, dedupe_key)`, o que torna notificar idempotente.

Exclusão por votação: `match_day_deletion_votes` (uma por pelada) → `match_day_deletion_voters` (eleitorado congelado + o voto).

Acesso: `users` (um por `player`) guarda `password_hash` **ou** `google_sub`, os dois nulos-a-nulo mas nunca ambos vazios — conta nascida pelo Google não tem senha, conta de senha só ganha `google_sub` ao vincular. `email` e `google_sub` são unique, e é o `sub` que identifica a pessoa (o e-mail pode trocar de dono num domínio corporativo). `invites.email` preenchido trava o convite naquela conta Google; nulo, é o convite antigo de usuário e senha.

Estatísticas são derivadas por query (`src/lib/stats.ts`), contando só peladas encerradas e só jogadores com conta ativa.

### Prazos e o varredor

Prazos são timestamps absolutos gravados na criação, comparados sempre com o `now()` do Postgres. Quem os aplica é `processarPendencias()` (`src/lib/pendencias.ts`), disparado pelo `after()` no layout (no máximo 1× por minuto por instância) e por `GET /api/cron/pendencias` como rede de segurança — protegido por `CRON_SECRET` e agendado no `vercel.json`. É idempotente: cada transição é `UPDATE ... WHERE status = 'open' RETURNING` e o replay recalcula do zero.

## Roadmap (fase 2)

- Grupo/racha como entidade: hoje jogadores, nota, artilharia e rankings são **globais** — se dois grupos diferentes usarem o app, os números se misturam

- Feed iCalendar (`/api/calendar.ics`) para assinar a agenda no Google/Apple Calendar
- Defesa contra conluio na avaliação — a denúncia só cobre nota injustamente baixa
- Convidados avulsos, "craque da noite", caixinha do grupo, streaks/badges
