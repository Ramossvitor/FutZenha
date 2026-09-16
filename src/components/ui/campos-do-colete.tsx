import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { NOME_DE_TIME_MAX } from "@/lib/regras";
import {
  ESCOLHA_OUTRA_COR,
  ESCOLHA_SEM_COLETE,
  escolhaInicialDoColete,
  SWATCHES_DE_COLETE,
} from "@/lib/team-colors";
import { CorLivre } from "./cor-livre";
import { Field, Input } from "./field";
import { VestChip } from "./vest";

/** O que o seletor livre mostra antes de alguém escolher: um cinza que não é amostra nenhuma. */
const COR_LIVRE_PADRAO = "#888888";

/**
 * Os campos de um colete — nome e cor —, os mesmos nos três formulários que o
 * editam: o /gerenciar do fut, o painel da súmula e os coletes do grupo. Quem
 * lê o que sai daqui é lerColeteDoForm (src/lib/coletes-form.ts): `nome`, o
 * rádio `cor` (um hex das amostras, "outra" ou "sem") e `corLivre`, o seletor
 * nativo — os três com o mesmo `sufixo`, para os blocos do grupo não colidirem.
 *
 * Empilhado, e não numa LinhaDeCampos: a faixa de amostras quebra linha no
 * celular, e um `<input type="color">` que caísse numa linha diferente do nome
 * desfaria a promessa de alinhamento que a linha existe para dar. Um campo por
 * linha não tem o que desalinhar.
 *
 * Sem JavaScript obrigatório: os rádios são o RadioGroup do field.tsx em forma
 * de amostra (`peer` + `sr-only`, com `aria-label` no input para o nome da cor
 * ser o nome acessível), e o único script — marcar "Outra cor" quando a pessoa
 * mexe no seletor — é enfeite (ver cor-livre.tsx).
 */
export function CamposDoColete({
  idBase,
  sufixo = "",
  nome = "",
  cor,
  corPadrao = null,
  obrigatorio = true,
}: {
  /** Prefixo dos ids — os rótulos apontam por `htmlFor`, e a página pode ter seis blocos. */
  idBase: string;
  /** Sufixo dos `name`s (`nome-0`, `cor-0`…), para os blocos do grupo não se atropelarem. */
  sufixo?: string;
  nome?: string;
  /** A cor gravada: hex, `null` = sem colete, `undefined` = nada gravado ainda (vale `corPadrao`). */
  cor?: string | null;
  corPadrao?: string | null;
  /** Falso nos blocos do grupo: linha em branco é linha não usada. */
  obrigatorio?: boolean;
}) {
  const campo = (base: string) => `${base}${sufixo}`;
  const escolha = escolhaInicialDoColete(cor, corPadrao);
  const corLivreInicial =
    escolha === ESCOLHA_OUTRA_COR && typeof cor === "string" ? cor : COR_LIVRE_PADRAO;
  const idOutra = `${idBase}-cor-outra`;

  return (
    <div className="flex flex-col gap-3">
      <Field htmlFor={`${idBase}-nome`} label="Nome" largura="medio" obrigatorio={obrigatorio}>
        <Input
          id={`${idBase}-nome`}
          name={campo("nome")}
          defaultValue={nome}
          placeholder="Nome do time"
          maxLength={NOME_DE_TIME_MAX}
          required={obrigatorio}
          autoComplete="off"
        />
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-display text-[12px] font-semibold text-fg-2">
          Cor do colete
        </legend>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES_DE_COLETE.map((amostra) => (
            <Amostra
              key={amostra.cor}
              id={`${idBase}-cor-${amostra.nome.toLowerCase()}`}
              name={campo("cor")}
              valor={amostra.cor}
              rotulo={amostra.nome}
              marcada={escolha === amostra.cor}
            >
              <VestChip cor={amostra.cor} tamanho="lg" />
            </Amostra>
          ))}
          <Amostra
            id={idOutra}
            name={campo("cor")}
            valor={ESCOLHA_OUTRA_COR}
            rotulo="Outra cor"
            marcada={escolha === ESCOLHA_OUTRA_COR}
            texto
          >
            Outra cor
          </Amostra>
          <CorLivre
            id={`${idBase}-cor-livre`}
            name={campo("corLivre")}
            idDoRadioOutra={idOutra}
            defaultValue={corLivreInicial}
          />
          <Amostra
            id={`${idBase}-cor-sem`}
            name={campo("cor")}
            valor={ESCOLHA_SEM_COLETE}
            rotulo="Sem colete"
            marcada={escolha === ESCOLHA_SEM_COLETE}
            texto
          >
            <VestChip cor={null} />
            Sem colete
          </Amostra>
        </div>
      </fieldset>
    </div>
  );
}

/**
 * Um rádio em forma de amostra: o input fica `sr-only` e o `peer-checked:`
 * pinta o rótulo — o RadioGroup do field.tsx, em quadradinho de 36px.
 */
function Amostra({
  id,
  name,
  valor,
  rotulo,
  marcada,
  texto = false,
  children,
}: {
  id: string;
  name: string;
  valor: string;
  rotulo: string;
  marcada: boolean;
  /** Pílula com texto em vez de quadradinho. */
  texto?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="relative">
      <input
        type="radio"
        id={id}
        name={name}
        value={valor}
        defaultChecked={marcada}
        aria-label={rotulo}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        title={rotulo}
        className={cx(
          "flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-ctl border border-line-strong bg-surface transition-colors select-none hover:border-line-hover peer-checked:border-accent-edge peer-checked:bg-accent-tint peer-checked:ring-2 peer-checked:ring-accent-edge peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
          texto ? "px-3 font-display text-[13px] font-semibold text-fg" : "w-9",
        )}
      >
        {children}
      </label>
    </span>
  );
}
