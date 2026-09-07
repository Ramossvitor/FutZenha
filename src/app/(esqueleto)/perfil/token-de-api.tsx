"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Section } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/field";
import { useArmado } from "@/components/ui/use-armado";
import { gerarTokenDeApi, revogarTokenDeApi } from "./actions";

/**
 * O token do relógio, no perfil: gerar, ver uma vez, gerar outro, revogar.
 *
 * O token recém-gerado vive só neste estado local — a página não o conhece
 * (só sabe se HÁ um) e o servidor não o guarda em claro. Fechou a tela, ele
 * se foi; o texto diz isso antes de a pessoa descobrir do jeito ruim.
 *
 * "Gerar outro" e "Revogar" pedem um segundo toque, com o mesmo `useArmado` do
 * desfazer da súmula (fut/[id]/sumula/painel.tsx): os dois matam o token que
 * está no relógio de alguém, e um toque errado aqui é um atalho morto na hora
 * do jogo.
 */
export function TokenDeApi({
  temToken,
  criadoHa,
  usadoHa,
  urlDaApi,
  hrefDoGuia,
}: {
  temToken: boolean;
  /** "há 3 dias", já formatado pelo servidor (segundos do Postgres + tempoAtras). */
  criadoHa: string | null;
  usadoHa: string | null;
  urlDaApi: string;
  hrefDoGuia: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"gerar" | "revogar" | null>(null);
  const [falhou, setFalhou] = useState(false);

  async function gerar() {
    setOcupado("gerar");
    try {
      const resultado = await gerarTokenDeApi();
      setToken(resultado.token);
      setFalhou(false);
    } catch {
      setFalhou(true);
    } finally {
      setOcupado(null);
    }
  }

  async function revogar() {
    setOcupado("revogar");
    try {
      await revogarTokenDeApi();
      setToken(null);
      setFalhou(false);
    } catch {
      setFalhou(true);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Section titulo="Súmula no relógio">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <p className="text-[13px] leading-[1.5] text-fg-2">
            Um token para o Apple Watch lançar gol pelo app Atalhos, sem tirar o celular do
            bolso. Ele só serve para a súmula ao vivo dos futs que você já opera — nada mais.
            O passo a passo está no{" "}
            <a href={hrefDoGuia} className="text-accent-ink underline-offset-2 hover:underline">
              guia
            </a>
            .
          </p>

          {falhou && <Banner tom="erro">Não deu. Confere a conexão e tenta de novo.</Banner>}

          {token !== null ? (
            <>
              <Banner tom="aviso">
                Copie agora — o token não aparece de novo. Perdeu, gere outro.
              </Banner>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={token}
                  aria-label="Token de API"
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-[12px]"
                />
                <CopyButton text={token} className="shrink-0" />
              </div>
            </>
          ) : temToken ? (
            <p className="text-[13px] text-fg-2">
              Token ativo{criadoHa && <> · criado {criadoHa}</>} · último uso{" "}
              <strong className="text-fg">{usadoHa ?? "nunca"}</strong>
            </p>
          ) : null}

          <p className="text-[12px] leading-[1.45] text-fg-4">
            Endereço da API para os atalhos:{" "}
            <code className="rounded bg-surface-2 px-1 text-fg-2">{urlDaApi}</code>
          </p>

          <div className="flex flex-wrap gap-2">
            {temToken || token !== null ? (
              <>
                <BotaoEmDoisToques
                  rotulo="Gerar outro"
                  confirmacao="Confirmar: o atual para de valer"
                  variante="secondary"
                  pending={ocupado === "gerar"}
                  disabled={ocupado !== null}
                  onConfirmar={gerar}
                />
                <BotaoEmDoisToques
                  rotulo="Revogar"
                  confirmacao="Confirmar: revogar o token"
                  variante="danger-outline"
                  pending={ocupado === "revogar"}
                  disabled={ocupado !== null}
                  onConfirmar={revogar}
                />
              </>
            ) : (
              <Button
                tamanho="sm"
                pending={ocupado === "gerar"}
                labelPending="Gerando…"
                onClick={gerar}
              >
                Gerar token
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </Section>
  );
}

/** Arma no primeiro toque, executa no segundo (src/components/ui/use-armado.ts). */
function BotaoEmDoisToques({
  rotulo,
  confirmacao,
  variante,
  pending,
  disabled,
  onConfirmar,
}: {
  rotulo: string;
  confirmacao: string;
  variante: "secondary" | "danger-outline";
  pending: boolean;
  disabled: boolean;
  onConfirmar: () => void;
}) {
  const [armado, setArmado] = useArmado();

  return (
    <Button
      variante={armado ? "danger" : variante}
      tamanho="sm"
      pending={pending}
      disabled={disabled}
      onClick={() => {
        if (!armado) {
          setArmado(true);
          return;
        }
        setArmado(false);
        onConfirmar();
      }}
    >
      {armado ? confirmacao : rotulo}
    </Button>
  );
}
