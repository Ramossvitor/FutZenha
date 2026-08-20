import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { criarConvite, criarJogador, criarJogadorComConta } from "@/test/fixtures";
import { materializarPlatformAdmins, provisionarPlatformAdmins } from "./platform-admins-bootstrap";

// O bootstrap fala SQL cru pela tag do postgres.js, não pelo drizzle — é o
// mesmo cliente por baixo, e reusá-lo mantém o pool (e o afterAll que o fecha)
// nas mãos do harness de integração.
const conn = db.$client;

const NOME_DO_ADMIN = "admin-da-plataforma";

function comEnvVar(valor: string) {
  vi.stubEnv("PLATFORM_ADMIN_USERNAMES", valor);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function contaDe(username: string) {
  const [conta] = await db.select().from(users).where(eq(users.username, username));
  return conta;
}

describe("provisionarPlatformAdmins", () => {
  it("cria jogador e conta admin quando o nome não existe", async () => {
    comEnvVar(NOME_DO_ADMIN);
    await provisionarPlatformAdmins(conn);

    const conta = await contaDe(NOME_DO_ADMIN);
    expect(conta?.isPlatformAdmin).toBe(true);
    // O convite de bootstrap nasce junto: é a única porta de um banco vazio.
    const [convite] = await db.select().from(invites).where(eq(invites.playerId, conta.playerId));
    expect(convite).toBeDefined();
    expect(convite.usedAt).toBeNull();
  });

  it("adota o jogador que já existe, quando ele está limpo", async () => {
    const jogador = await criarJogador({ name: NOME_DO_ADMIN });
    comEnvVar(NOME_DO_ADMIN);

    await provisionarPlatformAdmins(conn);

    const conta = await contaDe(NOME_DO_ADMIN);
    expect(conta?.playerId).toBe(jogador.id);
    expect(conta?.isPlatformAdmin).toBe(true);
    // Não duplicou a linha de players só porque o nome já estava lá.
    const jogadores = await db.select().from(players).where(eq(players.name, NOME_DO_ADMIN));
    expect(jogadores).toHaveLength(1);
  });

  // A regressão do takeover. Sem a trava, este teste termina com uma conta
  // is_platform_admin = true cujo convite PENDENTE está na mão de quem cadastrou
  // o jogador — e resgatá-lo é reset de senha, ou seja, a conta inteira.
  it("NÃO adota jogador com convite pendente — é o squat de nome", async () => {
    const squatado = await criarJogador({ name: NOME_DO_ADMIN });
    const conviteDoAtacante = await criarConvite(squatado);
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
    comEnvVar(NOME_DO_ADMIN);

    await provisionarPlatformAdmins(conn);

    expect(await contaDe(NOME_DO_ADMIN)).toBeUndefined();
    expect(avisos).toHaveBeenCalledOnce();
    expect(avisos.mock.calls[0][0]).toContain("convite PENDENTE");

    // E o convite do atacante segue sem valer nada: não há conta para resetar.
    const [aindaPendente] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, conviteDoAtacante.id));
    expect(aindaPendente.usedAt).toBeNull();
    const contas = await db.select().from(users).where(eq(users.playerId, squatado.id));
    expect(contas).toHaveLength(0);
  });

  // O convite já resgatado não é alavanca nenhuma — recusar por causa dele
  // deixaria um nome legítimo travado para sempre.
  it("adota quem tem convite JÁ USADO", async () => {
    const jogador = await criarJogador({ name: NOME_DO_ADMIN });
    await criarConvite(jogador, { usado: true });
    comEnvVar(NOME_DO_ADMIN);

    await provisionarPlatformAdmins(conn);

    expect((await contaDe(NOME_DO_ADMIN))?.playerId).toBe(jogador.id);
  });

  it("não mexe em quem já tem conta com esse username", async () => {
    const { conta } = await criarJogadorComConta({}, { username: NOME_DO_ADMIN });
    comEnvVar(NOME_DO_ADMIN);

    await provisionarPlatformAdmins(conn);

    // Provisionar não promove — quem promove é o materializar.
    const depois = await contaDe(NOME_DO_ADMIN);
    expect(depois?.id).toBe(conta.id);
    expect(depois?.isPlatformAdmin).toBe(false);
  });

  it("é idempotente: a segunda passada não cria nada", async () => {
    comEnvVar(NOME_DO_ADMIN);
    await provisionarPlatformAdmins(conn);
    await provisionarPlatformAdmins(conn);

    const contas = await db.select().from(users).where(eq(users.username, NOME_DO_ADMIN));
    expect(contas).toHaveLength(1);
  });
});

// O link de acesso é uma credencial de 7 dias que vale por senha de admin. Ele
// só pode aparecer no log quando não existe outro caminho para entrar.
describe("o link no log", () => {
  it("sai quando a instalação não tem nenhum admin", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    comEnvVar(NOME_DO_ADMIN);

    await provisionarPlatformAdmins(conn);

    expect(logs.mock.calls.map((c) => String(c[0])).join("\n")).toContain("/convite/");
  });

  it("NÃO sai quando já existe outro admin que pode gerar o convite pelo painel", async () => {
    await criarJogadorComConta({}, { username: "outro-admin", isPlatformAdmin: true });
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    comEnvVar(NOME_DO_ADMIN);

    await provisionarPlatformAdmins(conn);

    const impresso = logs.mock.calls.map((c) => String(c[0])).join("\n");
    expect(impresso).not.toContain("/convite/");
    expect(impresso).toContain("/admin/jogadores");

    // A conta foi criada mesmo assim: o que mudou é só onde o link aparece.
    expect((await contaDe(NOME_DO_ADMIN))?.isPlatformAdmin).toBe(true);
  });
});

describe("materializarPlatformAdmins", () => {
  it("liga a flag de quem já tinha conta", async () => {
    await criarJogadorComConta({}, { username: NOME_DO_ADMIN });
    comEnvVar(NOME_DO_ADMIN);

    await materializarPlatformAdmins(conn);

    expect((await contaDe(NOME_DO_ADMIN))?.isPlatformAdmin).toBe(true);
  });

  it("é aditivo: não rebaixa quem foi promovido pelo painel", async () => {
    await criarJogadorComConta({}, { username: "promovido-na-mao", isPlatformAdmin: true });
    comEnvVar(NOME_DO_ADMIN);

    await materializarPlatformAdmins(conn);

    expect((await contaDe("promovido-na-mao"))?.isPlatformAdmin).toBe(true);
  });
});
