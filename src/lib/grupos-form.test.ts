import { describe, expect, it } from "vitest";
import { parseGrupoForm } from "./grupos-form";

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

const valido = {
  name: "Pelada da firma",
  description: "Toda quarta às 20h",
  visibility: "public",
  joinPolicy: "request",
};

describe("parseGrupoForm", () => {
  it("aceita um grupo bem preenchido", () => {
    const r = parseGrupoForm(form(valido));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Pelada da firma");
      expect(r.data.visibility).toBe("public");
      expect(r.data.joinPolicy).toBe("request");
    }
  });

  it("apara o nome e recusa o que sobra curto demais", () => {
    const r = parseGrupoForm(form({ ...valido, name: "  ab  " }));
    expect(r.success).toBe(false);
  });

  it("recusa nome acima de 60 caracteres", () => {
    expect(parseGrupoForm(form({ ...valido, name: "a".repeat(61) })).success).toBe(false);
    expect(parseGrupoForm(form({ ...valido, name: "a".repeat(60) })).success).toBe(true);
  });

  it("descrição vazia vira null, e não string vazia", () => {
    const r = parseGrupoForm(form({ ...valido, description: "   " }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeNull();
  });

  // O ataque: o nome do grupo sai daqui direto para o assunto do email de
  // convite, e CR/LF em assunto é injeção de cabeçalho (um Bcc: enfileirado).
  // O trim só apara as pontas — a quebra no MEIO é o regex que barra.
  it("recusa quebra de linha no meio do nome, em qualquer formato", () => {
    for (const name of [
      "Pelada\nBcc: x@example.com",
      "Pelada\rBcc: x@example.com",
      "Pelada\r\nBcc: x@example.com",
    ]) {
      expect(parseGrupoForm(form({ ...valido, name })).success).toBe(false);
    }
  });

  // A borda deliberada: o trim roda ANTES do regex, então quebra só nas pontas
  // é aparada e o que sobra passa. Se a ordem do schema inverter, este teste
  // acusa — e espaço interno continua sendo nome normal, não injeção.
  it("quebra de linha só nas pontas é aparada, e o nome passa", () => {
    const r = parseGrupoForm(form({ ...valido, name: "\nPelada da firma\r\n" }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Pelada da firma");
    expect(parseGrupoForm(form({ ...valido, name: "Pelada de sábado à noite" })).success).toBe(true);
  });

  // O ataque: Server Action é endpoint POST público, e o <select> da tela não
  // valida nada. Sem o z.enum, um valor inventado chegaria ao insert — e a
  // coluna que decide quem enxerga o grupo guardaria lixo.
  it("recusa visibilidade e política fora do enum", () => {
    expect(parseGrupoForm(form({ ...valido, visibility: "publico" })).success).toBe(false);
    expect(parseGrupoForm(form({ ...valido, visibility: "" })).success).toBe(false);
    expect(parseGrupoForm(form({ ...valido, joinPolicy: "livre" })).success).toBe(false);
  });

  // Campo ausente é diferente de campo vazio: o `?? ""` do parse é o que impede
  // o zod de receber `null` e estourar com "expected string, received null".
  it("recusa formulário sem os campos, sem lançar", () => {
    expect(parseGrupoForm(new FormData()).success).toBe(false);
  });
});
