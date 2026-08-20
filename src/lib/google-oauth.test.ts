import { beforeEach, describe, expect, it, vi } from "vitest";
import { codeChallengeDe, gerarCodeVerifier, parseIdToken } from "./google-oauth";

function b64url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Monta um id_token com a assinatura que a gente não confere (ver parseIdToken). */
function idToken(claims: unknown): string {
  return `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(claims))}.assinatura-qualquer`;
}

const CLIENT_ID = "123-abc.apps.googleusercontent.com";

const CLAIMS = {
  sub: "104233123456789012345",
  email: "Vitor.Ramos@Gmail.com",
  email_verified: true,
  name: "Vitor Ramos",
  // `iss` e `aud` fazem parte do token real e agora são conferidos — ver o
  // comentário em parseIdToken sobre por que, mesmo dispensando a assinatura.
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
};

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
});

/** As mesmas claims, menos uma — o Google omite o que não tem. */
function sem(chave: keyof typeof CLAIMS): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...CLAIMS };
  delete copia[chave];
  return copia;
}

describe("parseIdToken", () => {
  it("extrai sub, email normalizado e nome", () => {
    expect(parseIdToken(idToken(CLAIMS))).toEqual({
      sub: "104233123456789012345",
      // Minúsculas aqui é o que faz o convite casar: o admin digita do jeito que
      // quiser e o Google devolve do jeito dele.
      email: "vitor.ramos@gmail.com",
      emailVerified: true,
      name: "Vitor Ramos",
    });
  });

  it("decodifica acento no nome", () => {
    const payload = parseIdToken(idToken({ ...CLAIMS, name: "José Antônio Gonçalves" }));
    // O payload do Google é UTF-8, e atob devolve latin1 — sem a conversão
    // explícita no base64urlDecode isto viraria "JosÃ© AntÃ´nio".
    expect(payload!.name).toBe("José Antônio Gonçalves");
  });

  it("aceita email_verified como string 'true'", () => {
    expect(parseIdToken(idToken({ ...CLAIMS, email_verified: "true" }))!.emailVerified).toBe(true);
  });

  // Não é null: parse e confiança são decisões separadas. Quem recusa é o
  // google-login.ts, que precisa distinguir "token ilegível" de "e-mail não
  // verificado" para dar a mensagem certa.
  it("email_verified falso ou ausente devolve emailVerified: false", () => {
    expect(parseIdToken(idToken({ ...CLAIMS, email_verified: false }))!.emailVerified).toBe(false);
    expect(parseIdToken(idToken(sem("email_verified")))!.emailVerified).toBe(false);
  });

  // Um token legítimo, emitido pelo Google para OUTRO projeto. Sem esta
  // checagem ele passaria — e a dispensa de assinatura se apoia justamente em
  // premissas que só valem para o token emitido para NÓS.
  it("recusa token de outro client_id", () => {
    expect(parseIdToken(idToken({ ...CLAIMS, aud: "outro-app.apps.googleusercontent.com" }))).toBeNull();
    expect(parseIdToken(idToken(sem("aud")))).toBeNull();
  });

  it("recusa emissor que não é o Google, nas duas formas aceitas", () => {
    expect(parseIdToken(idToken({ ...CLAIMS, iss: "https://evil.example" }))).toBeNull();
    expect(parseIdToken(idToken(sem("iss")))).toBeNull();
    // O Google emite as duas, e as duas valem.
    expect(parseIdToken(idToken({ ...CLAIMS, iss: "accounts.google.com" }))).not.toBeNull();
  });

  it("nome ausente ou vazio vira null", () => {
    expect(parseIdToken(idToken(sem("name")))!.name).toBeNull();
    expect(parseIdToken(idToken({ ...CLAIMS, name: "" }))!.name).toBeNull();
  });

  it("sem sub ou sem email → null", () => {
    expect(parseIdToken(idToken(sem("sub")))).toBeNull();
    expect(parseIdToken(idToken(sem("email")))).toBeNull();
    expect(parseIdToken(idToken({ ...CLAIMS, sub: "" }))).toBeNull();
    expect(parseIdToken(idToken({ ...CLAIMS, sub: 123 }))).toBeNull();
  });

  it("formato inválido → null", () => {
    expect(parseIdToken("")).toBeNull();
    expect(parseIdToken("so.duas")).toBeNull();
    expect(parseIdToken("a.b.c.d")).toBeNull();
    expect(parseIdToken(`${b64url("{}")}.nao-e-base64-de-json.sig`)).toBeNull();
  });

  it("payload que não é objeto → null", () => {
    expect(parseIdToken(idToken(null))).toBeNull();
    expect(parseIdToken(idToken("texto"))).toBeNull();
    expect(parseIdToken(idToken(42))).toBeNull();
  });
});

describe("PKCE", () => {
  // Vetor da RFC 7636, apêndice B. Errar o challenge só apareceria como
  // "invalid_grant" na troca do code, que não diz qual das pontas errou.
  it("codeChallengeDe segue o vetor da RFC 7636", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await codeChallengeDe(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("gerarCodeVerifier devolve base64url no tamanho que a RFC aceita", () => {
    const verifier = gerarCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(gerarCodeVerifier()).not.toBe(verifier);
  });
});
