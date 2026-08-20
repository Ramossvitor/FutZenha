import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import { hashPassword } from "../lib/password";
import { platformAdminsDoAmbiente } from "../lib/platform-admins";
import { VALIDADE_CONVITE_MS } from "../lib/regras";
import { siteUrl } from "../lib/site-url";

// O bootstrap do admin da plataforma, chamado por src/db/migrate.ts depois das
// migrations — em TODO build de produção, fora do journal do drizzle.
//
// Mora num módulo próprio, e não dentro do migrate, por um motivo concreto: o
// `migrate.ts` executa `main()` no topo do módulo, então importá-lo num teste
// dispararia o script inteiro. A trava contra squat de nome que vive aqui
// embaixo fecha uma tomada de conta de admin, e regra dessa altura não pode
// ficar em código que nenhum teste alcança — ver platform-admins-bootstrap.integration.test.ts.
//
// SQL cru (tag do postgres.js, parametrizada) e não drizzle, como o migrate:
// este código roda sob tsx, fora do Next, antes de o schema novo existir.

/**
 * Cria a conta de quem está em `PLATFORM_ADMIN_USERNAMES` e ainda não existe.
 *
 * Faz dois trabalhos que o `materializarPlatformAdmins` sozinho não fazia.
 *
 * O primeiro é **reservar o username**. A env var dá admin pelo *nome*, e quem
 * resgata um convite escolhe o próprio username: enquanto um nome da lista não
 * tivesse dono, qualquer portador de convite podia digitá-lo e sair admin da
 * plataforma — o proxy não é fronteira (Server Action é POST direto), então a
 * conta valia de verdade. Com a linha em `users` criada aqui, o nome já está
 * tomado e o resgate cai no ramo de "conta existente".
 *
 * O segundo é **destravar a instalação nova**. Sem `ADMIN_PASSWORD` não sobrou
 * ninguém que pudesse gerar o primeiro convite: `createInvite` exige admin da
 * plataforma e `convidarParaFut` exige jogador logado. O convite impresso
 * aqui é a única porta de entrada de um banco vazio.
 *
 * A senha nasce aleatória e é descartada — só se entra pelo convite, que para
 * conta existente funciona como redefinição de senha.
 */
export async function provisionarPlatformAdmins(conn: postgres.Sql) {
  const usernames = [...platformAdminsDoAmbiente()];
  if (usernames.length === 0) return;

  for (const username of usernames) {
    const [existente] = await conn`select id from users where username = ${username}`;
    if (existente) continue;

    // Um jogador com esse nome e sem conta serve; senão cria. Se o nome existe
    // e já tem conta com OUTRO username, `users.player_id` é unique e a linha
    // não caberia — avisa e sai, porque adivinhar outro nome seria pior.
    //
    // `temConvitePendente` é a trava contra squat de nome, e ela fecha uma
    // tomada de conta inteira. `players.name` é escolhido por quem chama
    // `convidarParaFut` — ou seja, por qualquer jogador logado, que vira admin
    // do próprio fut avulso e cadastra convidado com o nome que quiser. A
    // sequência era:
    //
    //   1. o atacante cria um `players.name` igual ao username que ele aposta
    //      que virá a ser admin, e guarda o token do convite que
    //      `criarJogadorComConvite` devolve (7 dias, visível na tela dele);
    //   2. mais tarde, aquele nome entra em PLATFORM_ADMIN_USERNAMES e este
    //      script ADOTA a linha squatada, criando em cima dela um `users` com
    //      is_platform_admin = true;
    //   3. o convite do passo 1 continua válido — o insert abaixo é SQL cru e
    //      não apaga pendentes, ao contrário de `gerarConvite`
    //      (src/lib/convites.ts), que apaga;
    //   4. o atacante abre o link velho. Como a conta agora EXISTE, o
    //      `claimInvite` cai no ramo de reset de senha, grava a senha dele e
    //      abre sessão. Admin da plataforma.
    //
    // A reserva de nome do `claimInvite` não pega este caminho: ela recusa quem
    // ESCOLHE um username da lista, e aqui o username foi herdado da adoção.
    // Por isso a trava tem que ser aqui — adotar só linha limpa.
    const [jogador] = await conn`
      select p.id,
             (u.id is not null) as "temConta",
             exists (
               select 1 from invites i where i.player_id = p.id and i.used_at is null
             ) as "temConvitePendente"
        from players p left join users u on u.player_id = p.id
       where p.name = ${username}`;

    let playerId: number;
    if (!jogador) {
      const [criado] = await conn`
        insert into players (name) values (${username}) returning id`;
      playerId = criado.id;
    } else if (jogador.temConta) {
      console.warn(
        `[migrate] "${username}" está em PLATFORM_ADMIN_USERNAMES, mas já existe um jogador ` +
          `com esse nome e outra conta. Nenhuma conta criada — resolva pelo painel.`,
      );
      continue;
    } else if (jogador.temConvitePendente) {
      console.warn(
        `[migrate] "${username}" está em PLATFORM_ADMIN_USERNAMES e existe um jogador com esse ` +
          `nome, mas ele tem convite PENDENTE — quem o segura viraria admin ao resgatá-lo. ` +
          `Nenhuma conta criada. Revogue o convite em /admin/jogadores e refaça o deploy; se ` +
          `você não reconhece esse jogador, ele foi cadastrado por outra pessoa e o nome está ` +
          `sendo disputado.`,
      );
      continue;
    } else {
      playerId = jogador.id;
    }

    const token = randomBytes(32).toString("base64url");
    const senhaDescartada = await hashPassword(randomBytes(32).toString("base64url"));
    // Num commit só: conta sem convite deixaria o username reservado e sem dono
    // possível, e convite sem conta reabriria a janela que isto veio fechar.
    await conn.begin(async (tx) => {
      await tx`
        insert into users (player_id, username, password_hash, is_platform_admin)
        values (${playerId}, ${username}, ${senhaDescartada}, true)`;
      // .toISOString() não é estilo. `expires_at` é `timestamp` SEM timezone, e um
      // Date cru sai daqui declarado como `timestamptz` (o postgres.js infere 1184
      // para Date), então o Postgres converte para a coluna usando o TimeZone da
      // SESSÃO: numa sessão em America/Sao_Paulo o convite nasce expirando 3h mais
      // cedo. A string vai sem tipo declarado e é gravada literalmente — que é o
      // que o drizzle escreve no resto do app (mapToDriverValue = toISOString) e o
      // que ele relê como UTC (mapFromDriverValue concatena "+0000").
      const expiraEm = new Date(Date.now() + VALIDADE_CONVITE_MS).toISOString();
      await tx`
        insert into invites (token, player_id, expires_at)
        values (${token}, ${playerId}, ${expiraEm})`;
    });

    // O link só sai no log no ÚNICO caso em que não há outro caminho: instalação
    // sem nenhum admin, onde ninguém pode abrir /admin/jogadores para gerar o
    // convite. Fora disso ele fica fora do log — é uma credencial de 7 dias que
    // vale por senha de admin, e o log de build da Vercel não é lugar para ela.
    //
    // A pergunta é feita DEPOIS do insert, então o `<> ${username}` não é
    // detalhe: sem ele a conta que acabamos de criar responderia por si mesma e
    // o bootstrap nunca imprimiria nada.
    const [outroAdmin] = await conn`
      select 1 from users where is_platform_admin = true and username <> ${username} limit 1`;

    if (!outroAdmin) {
      console.log(
        `[migrate] Instalação sem admin: conta criada para "${username}". Defina a senha em: ` +
          `${siteUrl()}/convite/${token}`,
      );
    } else {
      console.log(
        `[migrate] Conta de admin criada para "${username}" (player ${playerId}). O link de ` +
          `acesso NÃO sai no log: gere um convite para ele em /admin/jogadores.`,
      );
    }
  }
}

/**
 * Materializa `PLATFORM_ADMIN_USERNAMES` na coluna `is_platform_admin`.
 *
 * A env var já vale sozinha em runtime (ver src/lib/session.ts) — isto aqui é
 * só para a flag aparecer no banco, que é onde as telas leem. Idempotente e
 * aditivo: só liga, nunca desliga, então promover alguém pelo painel não é
 * desfeito pelo build seguinte. Pega o caso de uma conta que já existia quando o
 * username entrou na lista; conta nova quem cria é o provisionarPlatformAdmins.
 *
 * Sem bump em token_version: o papel é lido do banco a cada request (getSession),
 * então a mudança vale no request seguinte sem derrubar a sessão de ninguém.
 */
export async function materializarPlatformAdmins(conn: postgres.Sql) {
  const usernames = [...platformAdminsDoAmbiente()];
  if (usernames.length === 0) return;

  const promovidos = await conn`
    update users
       set is_platform_admin = true
     where username in ${conn(usernames)} and is_platform_admin = false
    returning username`;

  if (promovidos.length > 0) {
    console.log(`[migrate] Admin da plataforma: ${promovidos.map((p) => p.username).join(", ")}`);
  }
}
