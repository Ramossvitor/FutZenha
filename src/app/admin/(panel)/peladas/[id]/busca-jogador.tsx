"use client";

import { useState, type ReactNode } from "react";

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

  if (itens.length === 0) return <p className="text-sm text-neutral-500">{vazio}</p>;

  return (
    <div className="flex flex-col gap-2">
      {/* Com poucos nomes a busca só atrapalha. */}
      {itens.length > 8 && (
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={`Buscar entre ${itens.length} jogadores...`}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
      )}

      {filtrados.length === 0 ? (
        <p className="text-sm text-neutral-500">{semResultado}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {filtrados.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 py-1">
              <span>{item.nome}</span>
              {item.apelido && (
                <span className="text-sm text-neutral-500">“{item.apelido}”</span>
              )}
              {item.selos}
              <span className="ml-auto flex gap-1">{item.acoes}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
