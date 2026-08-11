import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { cookieJar } from "@/test/cookie-store";
import { criarConta, criarConvite, criarJogador } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";
import { claimInvite } from "./actions";

const SENHA_NOVA = "senha-nova-123";
const ERRO_CONVITE_INVALIDO =
  "Convite inválido ou expirado. Fala com quem te convidou para gerar outro.";

// `contactEmail` entra por padrão porque é obrigatório para quem ainda não tem
// endereço na conta — os testes que existem antes dele não são sobre isso.
// Passar `null` explicitamente é como se testa o campo em branco.
function formularioDeClaim(
  campos: {
    username?: string;
    password?: string;
    confirm?: string;
    contactEmail?: string | null;
  } = {},
): FormData {
  const form = new FormData();
  if (campos.username !== undefined) form.set("username", campos.username);
  form.set("password", campos.password ?? SENHA_NOVA);
  form.set("confirm", campos.confirm ?? campos.password ?? SENHA_NOVA);
  const contato = campos.contactEmail === undefined ? "novato@example.com" : campos.contactEmail;
  if (contato !== null) form.set("contactEmail", contato);
  return form;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("claimInvite", () => {
  it("cria a conta, marca o convite como usado e deixa o jogador logado", async () => {
    // Stub próprio por cima do stub do setup só para o assert explícito de que
    // o claim não dispara nenhum HTTP.
    const fetchFake = vi.fn();
    vi.stubGlobal("fetch", fetchFake);

    const jogador = await criarJogador();
    const convite = await criarConvite(jogador);

    const destino = await esperaRedirect(
      claimInvite(convite.token, {}, formularioDeClaim({ username: "novato" })),
    );
    expect(destino).toBe("/");

    const [conta] = await db.select().from(users).where(eq(users.playerId, jogador.id));
    expect(conta).toBeDefined();
    expect(conta.username).toBe("novato");
    expect(conta.passwordHash).not.toBeNull();

    const [conviteDepois] = await db.select().from(invites).where(eq(invites.id, convite.id));
    expect(conviteDepois.usedAt).not.toBeNull();

    expect(cookieJar.has(SESSION_COOKIE)).toBe(true);
    const sessao = await getSession();
    expect(sessao?.userId).toBe(conta.id);
    expect(sessao?.player.id).toBe(jogador.id);

    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("recusa convite já usado sem criar nada", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { usado: true });

    const resultado = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "novato" }),
    );

    expect(resultado).toEqual({ error: ERRO_CONVITE_INVALIDO });
    expect(await db.select().from(users)).toHaveLength(0);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("recusa convite expirado sem criar nada", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { expiradoHaMinutos: 60 });

    const resultado = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "novato" }),
    );

    expect(resultado).toEqual({ error: ERRO_CONVITE_INVALIDO });
    expect(await db.select().from(users)).toHaveLength(0);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("recusa username listado em PLATFORM_ADMIN_USERNAMES e não queima o convite", async () => {
    vi.stubEnv("PLATFORM_ADMIN_USERNAMES", "chefe,super");
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador);

    const resultado = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "chefe" }),
    );

    expect(resultado).toEqual({ error: "Esse nome de usuário não está disponível." });
    expect(await db.select().from(users)).toHaveLength(0);
    const [conviteDepois] = await db.select().from(invites).where(eq(invites.id, convite.id));
    expect(conviteDepois.usedAt).toBeNull();
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("guarda o e-mail de contato normalizado e NÃO grava users.email", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador);

    await esperaRedirect(
      claimInvite(
        convite.token,
        {},
        formularioDeClaim({ username: "novato", contactEmail: "  Novato@Example.COM " }),
      ),
    );

    const [conta] = await db.select().from(users).where(eq(users.playerId, jogador.id));
    expect(conta.contactEmail).toBe("novato@example.com");
    // O coração da separação: o endereço que a pessoa digitou é contato, não
    // credencial. Se ele caísse em `email`, um login pelo Google com esse
    // endereço vincularia a conta de outra pessoa a esta linha.
    expect(conta.email).toBeNull();
  });

  it("sem e-mail de contato, não cria conta nem queima o convite", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador);

    const resultado = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "novato", contactEmail: null }),
    );

    expect(resultado).toEqual({ error: "Informe seu e-mail." });
    expect(await db.select().from(users)).toHaveLength(0);
    const [conviteDepois] = await db.select().from(invites).where(eq(invites.id, convite.id));
    expect(conviteDepois.usedAt).toBeNull();
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("recusa e-mail de contato inválido sem criar nada", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador);

    const resultado = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "novato", contactEmail: "sem-arroba" }),
    );

    expect(resultado).toEqual({ error: "E-mail inválido — confira o endereço." });
    expect(await db.select().from(users)).toHaveLength(0);
  });

  // Sem unique na coluna: ela guarda dado que ninguém verificou, e unicidade
  // ali deixaria alguém reivindicar o endereço de outro e trancá-lo fora.
  it("dois jogadores podem informar o mesmo e-mail de contato", async () => {
    const primeiro = await criarJogador();
    const segundo = await criarJogador();
    const conviteDoPrimeiro = await criarConvite(primeiro);
    const conviteDoSegundo = await criarConvite(segundo);

    await esperaRedirect(
      claimInvite(
        conviteDoPrimeiro.token,
        {},
        formularioDeClaim({ username: "irmao1", contactEmail: "casa@example.com" }),
      ),
    );
    cookieJar.limpar();
    await esperaRedirect(
      claimInvite(
        conviteDoSegundo.token,
        {},
        formularioDeClaim({ username: "irmao2", contactEmail: "casa@example.com" }),
      ),
    );

    const contas = await db.select().from(users);
    expect(contas).toHaveLength(2);
    expect(contas.every((c) => c.contactEmail === "casa@example.com")).toBe(true);
  });

  it("emailSentAt preenchido não muda o claim; usado uma vez, o convite não vale mais", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { emailEnviadoHaMinutos: 30 });

    const destino = await esperaRedirect(
      claimInvite(convite.token, {}, formularioDeClaim({ username: "novato" })),
    );
    expect(destino).toBe("/");

    cookieJar.limpar();
    const segundaVez = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "intruso" }),
    );

    expect(segundaVez).toEqual({ error: ERRO_CONVITE_INVALIDO });
    expect(await db.select().from(users)).toHaveLength(1);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });
});

// Resgatar convite de quem já tem conta é reset de senha — e é a última chance
// de pedir o endereço de quem entrou antes de o campo existir.
describe("claimInvite no reset de senha", () => {
  it("exige o e-mail de quem não tem endereço nenhum", async () => {
    const jogador = await criarJogador();
    await criarConta(jogador, { username: "antigo" });
    const convite = await criarConvite(jogador);

    const resultado = await claimInvite(convite.token, {}, formularioDeClaim({ contactEmail: null }));

    expect(resultado).toEqual({ error: "Informe seu e-mail." });
    const [conviteDepois] = await db.select().from(invites).where(eq(invites.id, convite.id));
    expect(conviteDepois.usedAt).toBeNull();
  });

  it("grava o endereço junto com a senha nova", async () => {
    const jogador = await criarJogador();
    const conta = await criarConta(jogador, { username: "antigo" });
    const convite = await criarConvite(jogador);

    await esperaRedirect(
      claimInvite(convite.token, {}, formularioDeClaim({ contactEmail: "antigo@example.com" })),
    );

    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBe("antigo@example.com");
    expect(depois.email).toBeNull();
    expect(depois.tokenVersion).toBe(conta.tokenVersion + 1);
  });

  // Campo em branco no reset de quem já tem endereço não pode APAGAR o que
  // havia — o formulário nem mostra o campo nesse caso.
  it("não apaga o contato existente quando o campo vem vazio", async () => {
    const jogador = await criarJogador();
    const conta = await criarConta(jogador, {
      username: "antigo",
      contactEmail: "guardado@example.com",
    });
    const convite = await criarConvite(jogador);

    await esperaRedirect(claimInvite(convite.token, {}, formularioDeClaim({ contactEmail: null })));

    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBe("guardado@example.com");
  });

  it("conta com e-mail do Google não precisa informar contato", async () => {
    const jogador = await criarJogador();
    const conta = await criarConta(jogador, {
      username: "googler",
      email: "googler@example.com",
      googleSub: "sub-googler",
    });
    const convite = await criarConvite(jogador);

    await esperaRedirect(claimInvite(convite.token, {}, formularioDeClaim({ contactEmail: null })));

    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBeNull();
    expect(depois.email).toBe("googler@example.com");
  });

  it("endereço novo sobrescreve o contato antigo", async () => {
    const jogador = await criarJogador();
    const conta = await criarConta(jogador, {
      username: "antigo",
      contactEmail: "velho@example.com",
    });
    const convite = await criarConvite(jogador);

    await esperaRedirect(
      claimInvite(convite.token, {}, formularioDeClaim({ contactEmail: "novo@example.com" })),
    );

    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBe("novo@example.com");
  });
});
