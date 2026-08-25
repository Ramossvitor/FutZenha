# ⚽ FutZenha

Site para organizar o fut semanal do grupo: confirmação de presença, sorteio de times balanceado, resultados, artilharia e rankings.

**Modelo de uso:** cada jogador tem uma conta (criada via link de convite entregue no WhatsApp) e marca **apenas a própria presença**. As páginas continuam públicas para consulta. Sem e-mail, sem serviço externo — o convite é o único canal de cadastro e também serve de reset de senha.

**Dois papéis de admin**, e um jogador pode ser os dois:

| | Admin do fut | Admin da plataforma |
|---|---|---|
| Quem é | quem **criou** aquele fut | jogador com a flag `is_platform_admin` |
| Onde | `/fut/[id]/gerenciar` | `/admin` |
| Pode | presenças, sorteio, placar, gols, encerrar, abrir votação de exclusão, cadastrar jogador novo | contas e convites, julgar denúncias de nota injusta, ver o uso do sistema, excluir fut fabricado — e é fallback em qualquer fut |

Qualquer jogador logado marca um fut em `/futs/novo` e vira admin **dele**.

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
| `npm run typecheck` | `next typegen && tsc --noEmit` — o `typegen` é obrigatório, ver a seção de deploy |
| `npm run db:generate` | Gera migration a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrations no banco do `DATABASE_URL` |
| `npm run db:migrate:prod` | Aplica migrations usando a connection string direta (conserto manual) |
| `npm run db:studio` | UI para inspecionar o banco |
| `npm run seed` | **Apaga tudo** e repopula com dados de exemplo (só banco local) |

## Fluxo de um fut

1. Qualquer jogador logado cria o fut em `/futs/novo` (data, hora, local) e vira o **admin dele**.
2. O link público (`/fut/[id]`) vai no grupo do WhatsApp; cada um entra na conta e marca **Vou / Fora** (só a própria presença). O admin do fut marca por **quem ainda não tem acesso** e cadastra quem chegou de última hora; quem já tem conta ativa entra e marca sozinho — depois disso o admin também ajusta a presença dessa pessoa. É o que impede alguém de marcar um fut e escalar gente que nunca soube do jogo, mexendo na presença e no V/E/D dela.
3. No dia, o admin do fut sorteia os times (balanceado por nota, goleiros separados) e ajusta manualmente se quiser.
4. Durante/depois, ele lança os jogos, placares e gols.
5. **Conferir escalação e encerrar**: revisa quem jogou em qual time, jogo a jogo, e confirma. Isso trava o fut, faz os números contarem na artilharia, nos rankings e na presença, e **abre a rodada de avaliação**.

### Depois de encerrar

A escalação confirmada é **imutável** — é ela que define quem avalia quem, e mexer nela invalidaria avaliações já enviadas. Placar e gols ainda podem ser corrigidos por **24h**. Passado isso, a única forma de mexer num fut é **excluí-la**, o que exige votação (ver abaixo). Não existe "reabrir fut".

## Avaliação entre companheiros

A nota do jogador é **100% calculada** — o admin não digita mais. Todo mundo começa em **5,0**.

1. Encerrada o fut, cada jogador com conta recebe uma notificação e tem **36 horas** para dar de 0,5 a 5 estrelas (de meia em meia) aos companheiros com quem dividiu o lado em algum jogo daquele dia. A avaliação só acontece em **grupo de 3 ou mais com conta ativa no mesmo lado** — abaixo disso o time joga e conta para placar, artilharia e presença, mas não mexe em nota nenhuma. É a trava contra nota fabricada: sem ela, duas contas combinadas subiriam de 5,0 a 9,3 em cinco futs de mentira.
2. A rodada é apurada quando **todos avaliam** ou quando o prazo vence — o que vier primeiro.
3. As estrelas viram nota de forma direta: **cada meia estrela vale 1 ponto** (0,5★ = 1,0 … 5★ = 10,0), e a nota nova é `(2 × nota atual + média recebida) / 3`. Ou seja, um fut pesa **1/3**. Rodadas apuradas antes da meia estrela continuam valendo pela tabela da época (1★ = 1,0 · 2★ = 3,25 · 3★ = 5,5 · 4★ = 7,75 · 5★ = 10,0), congelada via `rating_rounds.legacy_scale` — o replay nunca reescreve nota passada com régua nova.
4. Todo mundo é notificado da mudança, e a nota nova aparece em `/rankings` e no perfil.

Detalhes que valem conhecer:

- **A nota é sempre recalculada do zero**, desde 5,0, a partir das avaliações que ainda valem. Não existe delta acumulado — é isso que faz descartar uma avaliação ou apagar um fut funcionarem sem código de desfazimento.
- A ordem do replay é a **data dos futs**, nunca a data de apuração: a nota é função das avaliações, não de quando o admin clicou.
- 10,0 e 1,0 só são alcançáveis com unanimidade sustentada (~10 futs seguidas), e uma única avaliação fora do padrão já tira o jogador do extremo.
- Quem tem convite pendente **joga normalmente** (presença, gols, escalação), mas não entra nos rankings e não avalia nem é avaliado. Ao resgatar o acesso, todo o histórico dele aparece de uma vez — a nota, porém, começa em 5,0: não há avaliação retroativa.

### Nota injusta

O jogador vê no perfil cada estrela que recebeu, **sem saber quem deu**, e pode reportar uma delas em até 24 horas após a apuração (a partir de 2 avaliações recebidas). Quem julga é o **admin da plataforma**, em `/admin/avaliacoes`, e ele tem 48 horas; **se não responder, a denúncia é aceita automaticamente**. Descartar uma avaliação recalcula a nota de todo mundo daquele fut em diante.

Julgar denúncia **não** é do admin do fut, de propósito: ele quase sempre jogou a rodada, então poderia julgar a própria denúncia — e, pior, descobriria de quem partiu a nota contestada. Aceitar uma denúncia também dispara o replay que recalcula a nota de todo mundo, o que é decisão de plataforma, não de fut.

Quem julga **vê o nome de quem avaliou** — o anonimato é entre jogadores, e para decidir é preciso saber de quem partiu a nota. Por isso a mesma regra vale para o admin da plataforma: **ele não julga denúncia de fut que jogou**. Ele é jogador como qualquer outro, então sem essa trava bastaria denunciar a própria nota para abrir a lista de quem lhe deu cada estrela. Nessas denúncias ele vê que existem e que o prazo corre, sem os nomes e sem os botões; decide outro admin da plataforma, ou o prazo vence e o auto-aceite resolve.

O anonimato tem um cuidado que não é óbvio: `ratings.id` é sequencial, então expor o id entregaria a ordem de envio. A tela trabalha com a **posição** na lista (ordenada por nota, com desempate por hash), e o id nunca sai do servidor.

### Excluir um fut

Fut **não encerrado** o admin dele apaga direto. Fut **encerrado** exige votação: o admin do fut abre com justificativa, e passa com **85% de SIM em 48h** entre quem jogou e tem conta. Não votar conta como **contra**, o voto é **definitivo**, e há **uma votação por fut** — rejeitada, ela fica no histórico para sempre. Aprovada, o fut é apagado com tudo que gerou e as notas são recalculadas. O pedido também tem hora: a votação só pode ser aberta **até 24 horas depois do fim do prazo de contestação das notas** (num fut sem rodada de avaliação, a janela equivalente conta do encerramento) — passado isso, o fut fica no histórico e só o admin da plataforma consegue apagá-lo.

Fora disso, o **admin da plataforma** pode excluir um fut direto em `/admin/futs`, sem votação. É a contrapartida de qualquer um poder criar fut: contra um fut fabricado não adianta votação, porque quem votaria são os "jogadores" dele. A tela mostra quem criou cada fut, quantos jogaram e quantos tinham conta ativa — que é o que denuncia fabricação. Como a exclusão é unilateral e irreversível, o motivo escrito é obrigatório e vai para o log do servidor junto com quem apertou o botão.

Enquanto a votação corre, quem propôs vê só **quantos** faltam votar — não o placar parcial nem os nomes. Com os dois, bastava recarregar antes e depois de alguém votar para saber como aquela pessoa votou, num voto que é definitivo.

## Contas de jogador

- **Criar conta**: em `/admin/jogadores`, o admin da plataforma clica em **Gerar convite** e manda o link no WhatsApp do jogador. O admin de um fut também cadastra gente nova pela própria tela de gestão, e o link do convite aparece ali mesmo, em **Convites para entregar** — só de quem ainda não tem conta, porque convite para quem já tem é reset de acesso e isso é da plataforma. O link (`/convite/[token]`) vale 7 dias e é de uso único. Nada é consumido ao abrir o link — só ao resgatar de verdade (bots de preview do WhatsApp não estragam o convite).
- **Convite com e-mail = convite de Google**: preenchendo o campo **E-mail (conta Google)** ao gerar o convite, o link só é resgatado por *aquela* conta Google — o formulário de usuário e senha nem aparece. É o que impede quem pegou o link no grupo de virar conta: o token sozinho não basta. Deixando o campo vazio, o convite segue no fluxo antigo, em que o jogador escolhe usuário e senha. Errou o e-mail? Revogue e gere outro; o convite trava no endereço digitado.
- **Entrar pelo Google**: quem tem conta Google vinculada entra pelo botão no `/login`. Quem já tinha usuário e senha vincula a própria conta em `/perfil` → **Conectar conta Google** (isso encerra as sessões nos outros aparelhos, como uma troca de senha). Conta nascida pelo Google não tem senha, e por isso não mostra "Trocar senha" no perfil. A identidade guardada é o `sub` do Google, não o e-mail: trocar de endereço não perde a conta.
- **Esqueceu a senha**: o admin da plataforma clica em **Resetar acesso (novo convite)** no mesmo lugar — o link redefine o acesso, derruba as sessões antigas e reativa a conta se estava desativada.
- **Desativar conta**: derruba a sessão do jogador no próximo acesso (a conta some sem apagar histórico; desativar o *jogador* é outra coisa — tira das listas mas a conta continua entrando).
- **Meu perfil** (`/perfil`): nota atual, estatísticas próprias (só futs encerrados), as estrelas recebidas em cada rodada e troca de senha.
- Cadastrar um jogador **já gera o convite** — ninguém nasce sem acesso a caminho. Com e-mail preenchido e `RESEND_API_KEY` configurada, o convite **já sai por e-mail** (e dá para reenviar); sem isso, o link segue saindo no WhatsApp como sempre. Quem já tem conta recebe o texto de **redefinir acesso**, não o de boas-vindas — é o mesmo botão de "Resetar acesso".
- **Freio do envio**: o mesmo endereço só recebe convite de 10 em 10 minutos, e quem convida para um grupo para no 40º aviso do dia. Não é economia: qualquer jogador logado marca um fut e vira admin dele, e daí alcançaria o cadastro com e-mail à escolha — sem freio, uma conta sozinha mandaria e-mail do nosso domínio para qualquer caixa de entrada. Os dois fluxos de lote têm teto próprio (40/dia a agenda, 60/dia o resumo do fut), porque mandam para o elenco inteiro de uma vez. **Não existe teto geral somando tudo**: existiu, e saiu porque a soma só funcionava enquanto todo fluxo soubesse contar os próprios envios — o dos avisos da caixa de entrada não sabia, e sozinho recusava o convite num dia de fut encerrado (o porquê está no cabeçalho de `src/lib/freios-de-envio.ts`). A cota do Resend continua sendo 100/dia; estourá-la agora volta como recusa dele, com o mesmo banner de copiar o link e mandar no WhatsApp.
- Logins de exemplo do seed: quatro contas com `senha123`, impressas no console (a primeira é o admin da plataforma) + um convite pendente.
- **Admin da plataforma**: `PLATFORM_ADMIN_USERNAMES` (lista por vírgula) vale como chave-mestra em runtime **e** liga a flag `users.is_platform_admin` a cada build. É o que impede ficar trancado do lado de fora de um banco sem shell. O build também **cria a conta** de quem está na lista e ainda não existe, imprimindo o link para definir a senha — é assim que nasce o primeiro admin de uma instalação nova. Esses usernames ficam **reservados**: ninguém consegue escolhê-los ao resgatar um convite, senão bastaria digitar o nome certo para sair admin.
- **Promover e rebaixar**: em `/admin/jogadores` dá para tornar outra conta admin da plataforma, ou tirar o papel. Mexer nisso encerra a sessão em curso da pessoa (`token_version + 1`). Ninguém se rebaixa sozinho, e quem está em `PLATFORM_ADMIN_USERNAMES` continua admin de qualquer jeito — a env var vence o banco.
- Sem rate limiting no login, de propósito (grupo fechado; o custo do scrypt já freia força bruta; mais que isso exigiria serviço de estado compartilhado, quebrando o R$ 0).

## Deploy (R$ 0)

Vercel Hobby + Neon free, domínio [futzenha.com.br](https://futzenha.com.br). **Push na `main` não publica nada** — o deploy por Git está desligado (`vercel.json` → `git.deploymentEnabled: false`) e publicar é sempre **Actions → Deploy (produção) → Run workflow**, que só chega no deploy se o gate ficar todo verde.

### Primeira vez

> Não crie a env var `DATABASE_URL` à mão — a integração do Neon precisa desse nome livre para injetar.

1. **Google Cloud** (pode ser antes de tudo, já que o domínio é conhecido): console.cloud.google.com → **APIs & Services → OAuth consent screen** → External, nome do app e e-mails de contato. Em **Scopes**, apenas `openid`, `userinfo.email` e `userinfo.profile` — é o que `src/lib/google-oauth.ts` pede, são não-sensíveis, e é por isso que o login sai de graça; qualquer escopo a mais joga o app na fila de review do Google. **Publique o app** (em *Testing* são no máximo 100 usuários cadastrados um a um). Depois **Credentials → Create credentials → OAuth client ID → Web application**, com estas Authorized redirect URIs:
   - `https://futzenha.com.br/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback`

   O Google confere a URI byte a byte, duas vezes — na ida e na troca do code —, então um `/` sobrando já reprova. Não cadastre `www.`: o apex é canônico e `siteUrl()` nunca devolve `www`.
2. **Banco**: vercel.com → **Storage** → **Create Database** → **Neon** → plano Free → nome `futzenha-db`. Deixe o branching de preview desligado.
3. **Projeto**: **Add New… → Project** → importe este repo (framework Next.js detectado). Antes de dar Deploy, adicione em Environment Variables:

   | Variável | Environments |
   |---|---|
   | `SESSION_SECRET` — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | Production, Preview, Development |
   | `PLATFORM_ADMIN_USERNAMES` — username(s) do admin da plataforma, separados por vírgula, **em minúsculas** (`platformAdminsDoAmbiente()` faz `toLowerCase()`) | Production, Preview, Development |
   | `CRON_SECRET` — `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` | Production |
   | `NEXT_PUBLIC_SITE_URL` = `https://futzenha.com.br` | **só** Production |
   | `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` | **só** Production |
   | `RESEND_API_KEY` — envio dos convites por e-mail (passo 10) | **só** Production |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` — avisos no aparelho (Web Push); gere o par com `npx web-push generate-vapid-keys` | **só** Production |

   `CRON_SECRET` protege `/api/cron/pendencias`, que fecha as rodadas de avaliação vencidas; sem ela a rota responde 503 (nunca "libera tudo") e os prazos passam a depender só do acesso ao site. As `GOOGLE_*` ficam fora de Preview de propósito: lá a URL muda a cada publicação e nunca bate com a redirect URI, então é melhor o botão sumir (`googleLoginConfigurado()` devolve `false`) do que dar erro do Google. A `RESEND_API_KEY` segue o mesmo racional: sem ela o envio vira no-op (`emailConfigurado()`) e o botão "Reenviar e-mail" some — em Preview é isso que se quer, teste não gasta a cota de 100 e-mails/dia. As duas chaves VAPID seguem o mesmo padrão — sem elas `pushConfigurado()` devolve `false`, a UI de "Avisos no aparelho" some e o despacho não roda. Duas ressalvas próprias: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` é **embutida em build time** (trocá-la exige rodar o workflow de novo) e **trocá-la invalida todas as assinaturas já cadastradas** — os devices antigos passam a receber 403 e precisam ativar de novo em `/perfil`. Há ainda a `VAPID_SUBJECT`, opcional: se definida, precisa ser `https://…` ou `mailto:…` (um e-mail solto derruba o despacho, que loga e vira no-op).
4. **O primeiro build falha de propósito** (`[migrate] Nenhuma connection string encontrada`): a Vercel só deixa conectar o banco depois que o projeto existe. Se o deploy por Git já estiver desligado, pode ser que nem chegue a buildar — tudo bem, o que importa é o projeto ter sido criado.
5. **Conectar o banco**: Project → **Storage** → **Connect Database** → `futzenha-db`, marcando Production, Preview e Development. Isso injeta `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` e as `PG*`.
6. **Secrets do GitHub** (Settings → Secrets and variables → Actions): `VERCEL_TOKEN` (Vercel → Account Settings → Tokens), `VERCEL_PROJECT_ID` (Projeto → Settings → General) e `VERCEL_ORG_ID` (Team/Account Settings → General). Atalho para os dois IDs: `vercel link` na sua máquina e leia `.vercel/project.json`, que é gitignored.
7. **Rode o workflow**. O log do build na Vercel deve mostrar `[migrate] Migrations aplicadas.`
8. **Pegue o link do primeiro admin no log do build**: como não existe senha de admin, o `migrate` cria a conta de quem está em `PLATFORM_ADMIN_USERNAMES` e imprime `[migrate] Conta de admin criada para "…". Defina a senha em: https://…/convite/<token>`. Abra o link, escolha a senha, e você entra como admin da plataforma. Depois vá em `/admin`, cadastre os jogadores reais e mande os convites. **Nunca rode o seed em produção** (ele apaga tudo — e há uma trava que impede isso).
9. **Domínio**: Vercel → Settings → Domains → `futzenha.com.br`, e `www.futzenha.com.br` como redirect para o apex. Use **os registros DNS que o painel mostrar** (os IPs da Vercel mudaram; tutoriais antigos citam `76.76.21.21`). No Registro.br, DNS → Editar Zona: um **A** no apex (campo de nome vazio ou `@`, não o domínio completo) e um **CNAME** no `www`. O certificado é emitido sozinho quando o DNS resolve.
10. **E-mail dos convites (Resend)**: crie a conta em resend.com → **Domains → Add Domain** → `futzenha.com.br`. Copie **os registros que o painel mostrar** para o Registro.br (DNS → Editar Zona) — tipicamente um TXT de DKIM em `resend._domainkey` e MX + TXT (SPF) no subdomínio `send`; use os valores do painel, não de tutorial. Quando o status virar **Verified**, crie a key em **API Keys** (permissão *Sending access*), adicione `RESEND_API_KEY` em Production e rode o workflow para ela valer. O remetente default é `FutZenha <convite@futzenha.com.br>` (não precisa existir como caixa de entrada — o domínio verificado autoriza o envio). Enquanto o domínio não verifica, o Resend só entrega para o e-mail do dono da conta, com remetente `onboarding@resend.dev` — para testar assim (local, por exemplo), defina também `EMAIL_FROM=onboarding@resend.dev`. Plano grátis: 3.000 e-mails/mês, 100/dia — de sobra; se um dia estourar o dia, o app avisa e o WhatsApp segue como plano B.

**Se perder o link do convite** (vale 7 dias e sai só no log do build): no SQL Editor do Neon, `select i.token, u.username from invites i join users u on u.player_id = i.player_id where i.expires_at > now();` e monte `https://futzenha.com.br/convite/<token>`. Se já expirou, a conta existe e o `provisionarPlatformAdmins` pula ela — acrescente um segundo username em `PLATFORM_ADMIN_USERNAMES` e rode o workflow: o build cria a conta nova e imprime um convite fresco.

`NEXT_PUBLIC_SITE_URL` é a fonte da redirect URI do Google, então em produção ela é fixada em vez de derivada. Como toda var `NEXT_PUBLIC_*`, **o valor é embutido em build time**: trocar de domínio depois exige rodar o workflow de novo, não basta editar no painel. Sem ela, `src/lib/site-url.ts` cairia em `VERCEL_PROJECT_PRODUCTION_URL` — que costuma estar certo, mas "costuma" não serve para uma URI que o Google compara byte a byte.

### Lançando atualizações

1. Commit e push na `main` (isso **não** publica nada).
2. **Actions → Deploy (produção) → Run workflow.**

O gate roda, nesta ordem: **vitest** → **eslint** → **typecheck** → **dry-run das migrations** num Postgres limpo do runner, duas vezes seguidas (a segunda prova idempotência, que é o cenário real — o script roda em todo build, não só quando há migration nova) → **`next build`**. Só no all-green o job de deploy existe. O deploy usa `vercel deploy --prod` **sem `--prebuilt`**, então o build acontece na infra da Vercel com as env vars de lá: a connection string do Neon nunca chega ao GitHub.

O `next build` fecha o gate porque é a única etapa que, em produção, roda **depois** das migrations (`npm run build` é `tsx src/db/migrate.ts && next build`): sem ele, um erro de prerender só apareceria com o schema já alterado.

O script `typecheck` é `next typegen && tsc --noEmit`, e o `typegen` **não é opcional**: `next-env.d.ts` é gitignored e importa `.next/types/*`, que só existe depois dele. Simplificar para `tsc --noEmit` quebra o CI.

- **Mudança de schema**: edite `src/db/schema.ts` → `npm run db:generate` → **leia o SQL gerado** → `npm run db:migrate` no banco local e teste → commit incluindo `schema.ts` **e** a pasta `drizzle/` inteira → push → rode o workflow. Nunca edite uma migration já enviada; gere uma nova.
- **Migration arriscada**: o gate roda contra um banco **vazio**, então um `ADD COLUMN ... NOT NULL` sem default passa liso lá e explode em produção. Para esses casos, crie um branch do Neon (cópia dos dados) e rode `DIRECT_DATABASE_URL=<branch> npm run db:migrate:prod` antes de disparar o workflow — é para isso que essa var existe.
- **Rollback não desfaz migration.** Como as migrations rodam dentro do build, se o `next build` falhar depois delas o schema avança sem o código ir ao ar. O `next build` do gate cobre a maior parte disso (o mesmo erro apareceria antes, no runner), mas não o que só quebra com as env vars da Vercel — então prefira migrations aditivas.

Limites esperados do free tier: o Neon dorme após ~5 min sem uso, então a primeira visita do dia leva 1–3s a mais. O cron do plano Hobby roda uma vez por dia, em **UTC** — `0 9 * * *` é 06:00 de Brasília.

## Modelo de dados (resumo)

`players` → `attendances` ← `match_days` (com `created_by_player_id` = o admin daquele fut; nulo = órfão — anterior a este modelo ou de criador apagado — e só a plataforma administra, sem dono inventado por backfill) → `teams` → `team_players`; `games` (time A × time B com placar) → `goals` (autor + quantidade) e `game_players` (quem jogou de qual lado **naquele jogo**). O placar digitado não precisa bater com a soma dos gols — cobre gol contra e gol sem autor lembrado.

`game_players` é a fonte de verdade de quem jogou: `teams` guarda só o colete do fut. É dela que saem o V/E/D e os "companheiros" da avaliação.

Avaliação: `rating_rounds` (uma por fut) → `rating_round_raters` (o denominador congelado de quem deve avaliar) e `ratings` (`discarded_at` nulo = vale) → `rating_reports`. `skill_history` é **projeção** do replay, reescrita inteira a cada recálculo. `notifications` tem unique em `(player_id, dedupe_key)`, o que torna notificar idempotente — e é também o outbox dos dois canais de aceleração, pelas colunas `push_dispatched_at` e `email_dispatched_at` (ver *Avisos: onde cada coisa chega*).

Exclusão por votação: `match_day_deletion_votes` (uma por fut) → `match_day_deletion_voters` (eleitorado congelado + o voto).

Acesso: `users` (um por `player`) guarda `password_hash` **ou** `google_sub`, os dois nulos-a-nulo mas nunca ambos vazios — conta nascida pelo Google não tem senha, conta de senha só ganha `google_sub` ao vincular. `email` e `google_sub` são unique, e é o `sub` que identifica a pessoa (o e-mail pode trocar de dono num domínio corporativo). `invites.email` preenchido trava o convite naquela conta Google; nulo, é o convite antigo de usuário e senha.

Estatísticas são derivadas por query (`src/lib/stats.ts`), contando só futs encerrados e só jogadores com conta ativa.

### Prazos e o varredor

Prazos são timestamps absolutos gravados na criação, comparados sempre com o `now()` do Postgres. Quem os aplica é `processarPendencias()` (`src/lib/pendencias.ts`), disparado pelo `after()` no layout (no máximo 1× por minuto por instância) e por `GET /api/cron/pendencias` como rede de segurança — protegido por `CRON_SECRET` e agendado no `vercel.json`. É idempotente: cada transição é `UPDATE ... WHERE status = 'open' RETURNING` e o replay recalcula do zero.

### Avisos: onde cada coisa chega

A **caixa de entrada** (`/notificacoes`) é a fonte de verdade e recebe tudo. Os
outros dois canais são aceleração, e a mesma tabela `notifications` é o outbox
dos dois: `push_dispatched_at` para o Web Push, `email_dispatched_at` para o
e-mail. Quem grava o aviso não sabe de nenhum dos dois.

**O que também sai por e-mail** (allowlist em `src/lib/email-avisos.ts` — tipo
que não está lá fica só no app):

| Aviso | Vai para | Desligável? |
|---|---|---|
| Te chamaram para um fut | o convidado | sim |
| Amanhã tem fut, você não respondeu | quem não respondeu | sim |
| Votação para excluir um fut | quem jogou | sim |
| Pediram para entrar no seu grupo | o admin do grupo | sim |
| Comprovante da recarga (Pix) | quem pagou | não |
| Recibo da compra na loja | quem comprou | não |
| Recarga estornada | admins da plataforma | não |

Mais dois que **não** passam pela caixa de entrada, porque existem para alcançar
quem *não* está no app — a pessoa cuja conta foi tomada: **senha alterada** e
**conta Google vinculada** (`src/lib/email-seguranca.ts`). Os dois saem sem
botão e sem link, de propósito: e-mail que avisa de credencial trocada e pede
clique ensina o reflexo que o phishing explora.

**Desligar**: `/perfil` → *Avisos por e-mail* (`users.avisos_por_email`). Vale só
para os avisáveis — comprovante de dinheiro e aviso de segurança continuam
saindo, e por isso só os desligáveis levam o header `List-Unsubscribe`.

O despacho é **at-most-once** (marca antes de enviar, como o push): um crash
perde aquele lote e nunca duplica — o aviso continua na caixa de entrada, que é
o que torna a perda aceitável. Roda no `after()` do layout (1× por minuto por
instância) e no cron; convite de fut e confirmação de Pix furam o throttle,
porque esperar o próximo pageview é apostar que ele acontece a tempo.

## Grupos

Um grupo reúne quem joga junto. Quem cria vira **administrador**; ele promove
**organizadores** (que marcam futs do grupo e convidam gente) e todo o resto
entra como **membro** — confirma presença e aparece no ranking do grupo.

Cada grupo escolhe como é encontrado:

| Visibilidade | Como se entra |
| --- | --- |
| **Privado** | Não aparece em listagem nenhuma. Só por link de convite ou convite nominal. |
| **Público** + sob aprovação | Aparece em `/grupos`; a pessoa solicita e o admin decide. |
| **Público** + entrada livre | Aparece em `/grupos`; qualquer conta entra sozinha. |

Os três caminhos de entrada convivem: link com token (multi-uso, opcionalmente
com teto), convite nominal a quem já tem conta (a pessoa aceita em `/grupos`) e
pedido de entrada. O link **não cria conta** — quem não tem passa antes pelo
cadastro normal.

Marcar um fut dentro do grupo não fecha o fut para o grupo: o organizador
continua podendo convidar gente de fora, inclusive quem não tem conta (o que
gera o link de cadastro de sempre).

**Ranking do grupo** (`/grupo/[id]/ranking`) tem presença, artilharia,
aproveitamento e notas, contando **só os futs daquele grupo** — e contando
todo mundo que jogou nelas, membro ou não. Os rankings gerais da plataforma
continuam existindo e continuam somando tudo. A nota mostrada no grupo é a nota
global do jogador: não existe nota por grupo, e a lista apenas recorta quem
jogou ali.

Fut sem grupo continua funcionando como sempre — `match_days.group_id` é
nulo, e o grupo é definido na criação e não muda depois.

## Roadmap (fase 2)

- Feed iCalendar (`/api/calendar.ics`) para assinar a agenda no Google/Apple Calendar
- Defesa contra conluio na avaliação — a denúncia só cobre nota injustamente baixa
- Convidados avulsos, "craque da noite", caixinha do grupo, streaks/badges
