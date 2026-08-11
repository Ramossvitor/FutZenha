import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { escopo, jogouNoGrupo } from "./stats-escopo";

// Compila o fragmento em SQL de verdade, sem banco nenhum: `sqlToQuery` é o
// mesmo caminho que o drizzle usa para montar a query final, então o que estes
// testes leem é o WHERE que o Postgres receberia.
//
// O que se protege aqui é uma falha SILENCIOSA. Se `eq(matchDays.groupId, ...)`
// sumisse de `escopo()`, ou se `jogouNoGrupo` perdesse o `status = 'finished'`,
// nada quebraria: as páginas renderizariam igual, os outros testes passariam, e
// o ranking do grupo só passaria a mostrar os números da plataforma inteira.
const dialect = new PgDialect();
const compilar = (fragmento: ReturnType<typeof escopo>) =>
  fragmento ? dialect.sqlToQuery(fragmento) : { sql: "", params: [] };

describe("escopo", () => {
  it("sem recorte, filtra só pelos futs encerrados", () => {
    const { sql, params } = compilar(escopo());
    expect(sql).toContain("status");
    expect(sql).not.toContain("group_id");
    expect(sql).not.toContain("extract(year");
    expect(params).toEqual(["finished"]);
  });

  it("com ano, não vaza filtro de grupo", () => {
    const { sql, params } = compilar(escopo({ year: 2026 }));
    expect(sql).toContain("extract(year");
    expect(sql).not.toContain("group_id");
    expect(params).toEqual(["finished", 2026]);
  });

  it("com grupo, filtra por group_id e segue exigindo encerrada", () => {
    const { sql, params } = compilar(escopo({ groupId: 7 }));
    expect(sql).toContain("group_id");
    expect(sql).toContain("status");
    expect(sql).not.toContain("extract(year");
    expect(params).toEqual(["finished", 7]);
  });

  it("as duas dimensões convivem", () => {
    const { sql, params } = compilar(escopo({ year: 2026, groupId: 7 }));
    expect(sql).toContain("extract(year");
    expect(sql).toContain("group_id");
    expect(params).toEqual(["finished", 2026, 7]);
  });

  // `groupId: 0` não existe (a coluna é serial, começa em 1), mas o guarda aqui
  // é contra o falsy: um `if (groupId)` distraído trataria 0 como "sem recorte".
  it("ignora groupId ausente sem confundir com zero", () => {
    expect(compilar(escopo({ groupId: undefined })).sql).not.toContain("group_id");
  });
});

describe("jogouNoGrupo", () => {
  // Este é o caminho que NÃO passa por `escopo()`: getSkillRanking parte de
  // `players`, então o filtro do grupo é reconstruído do zero ali. É o mais
  // provável de ficar para trás numa mudança futura.
  it("exige o grupo E o fut encerrado", () => {
    const { sql, params } = compilar(jogouNoGrupo(7));
    expect(sql).toContain("group_id");
    expect(sql).toContain("status");
    expect(params).toEqual([7, "finished"]);
  });
});
