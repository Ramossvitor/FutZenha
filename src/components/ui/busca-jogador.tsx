"use client";

import { useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";

// Os botões de cada linha vêm prontos do servidor como ReactNode — é assim que
// as Server Actions continuam sendo <form> normais e nenhuma regra do domínio
// atravessa a fronteira do cliente. Aqui só existe filtro de texto.
export type ItemJogador = {
  id: number;
  nome: string;
  apelido: string | null;
  selos?: ReactNode;
  acoes: ReactNode;
};

export function BuscaJogador({
  itens,
  vazio = "Ninguém por aqui.",
  semResultado = "Nenhum jogador com esse nome.",
}: {
  itens: ItemJogador[];
  vazio?: string;
  semResultado?: string;
}) {
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();

  // Filtra por nome e apelido: é por apelido que quase todo mundo é chamado.
  const filtrados = termo
    ? itens.filter(
        (i) =>
          i.nome.toLowerCase().includes(termo) ||
          (i.apelido?.toLowerCase().includes(termo) ?? false),
      )
    : itens;

  if (itens.length === 0) return <EmptyState titulo={vazio} />;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Com poucos nomes a busca só atrapalha. */}
      {itens.length > 8 && (
        <Input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={`Buscar entre ${itens.length} jogadores…`}
          aria-label="Buscar jogador"
        />
      )}

      {filtrados.length === 0 ? (
        <EmptyState titulo={semResultado} />
      ) : (
        <HairlineList as="ul">
          {filtrados.map((item) => (
            <HairlineRow as="li" key={item.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[14px] font-bold text-fg">
                  {item.apelido ?? item.nome}
                </span>
                {item.apelido && (
                  <span className="block truncate text-[11.5px] text-fg-4">{item.nome}</span>
                )}
              </span>
              {item.selos}
              <span className="ml-auto flex shrink-0 gap-1.5">{item.acoes}</span>
            </HairlineRow>
          ))}
        </HairlineList>
      )}
    </div>
  );
}
