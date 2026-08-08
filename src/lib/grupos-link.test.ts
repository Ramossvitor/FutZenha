import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { condicaoLinkVivo } from "./grupos-link";

// Mesma técnica de ./stats-escopo.test: compila o fragmento em SQL de verdade,
// sem banco. O que se protege aqui é a concordância entre os três chamadores —
// `linkAtivo`, a página do convite e a action de resgate — que antes tinham cada
// um a sua cópia da regra.
const dialect = new PgDialect();
const compilar = (fragmento: ReturnType<typeof condicaoLinkVivo>) =>
  fragmento ? dialect.sqlToQuery(fragmento) : { sql: "", params: [] };

describe("condicaoLinkVivo", () => {
  it("exige as três condições ao mesmo tempo", () => {
    const { sql: texto } = compilar(condicaoLinkVivo(sql`now()`));
    expect(texto).toContain("revoked_at");
    expect(texto).toContain("expires_at");
    expect(texto).toContain("max_uses");
    expect(texto).toContain("uses_count");
  });

  // Teto ausente é `max_uses is null`, não `max_uses = 0`: link que morre no
  // primeiro clique não serve para grupo de WhatsApp.
  it("trata teto nulo como sem limite, e não como limite zero", () => {
    const { sql: texto } = compilar(condicaoLinkVivo(sql`now()`));
    expect(texto).toMatch(/max_uses"? is null/i);
    expect(texto).toContain("or");
  });

  // A comparação é estrita: com usesCount === maxUses o link já morreu. Um `<=`
  // aqui daria uma entrada a mais do que o admin autorizou.
  it("compara usos com o teto de forma estrita", () => {
    const { sql: texto } = compilar(condicaoLinkVivo(sql`now()`));
    expect(texto).toMatch(/uses_count"? </);
    expect(texto).not.toMatch(/uses_count"? <=/);
  });

  // A validade também é estrita: expirado no instante exato não vale.
  it("compara a validade de forma estrita", () => {
    const { sql: texto } = compilar(condicaoLinkVivo(sql`now()`));
    expect(texto).toMatch(/expires_at"? >/);
    expect(texto).not.toMatch(/expires_at"? >=/);
  });

  // Só `now()` do Postgres, nunca Date do Node: a compilação de um Date até
  // funciona (era o que este teste conferia), mas o DRIVER quebra — Date em sql
  // cru não passa pelo mapeamento de coluna e o serializer passthrough do
  // postgres-js entrega o objeto inteiro ao escritor de bytes. Foi o crash da
  // tela de gestão de grupo em produção; a assinatura agora nem aceita Date.
  it("usa o relógio do Postgres, sem parâmetro", () => {
    const comSql = compilar(condicaoLinkVivo(sql`now()`));

    expect(comSql.sql).toContain("now()");
    expect(comSql.params).toEqual([]);
  });
});
