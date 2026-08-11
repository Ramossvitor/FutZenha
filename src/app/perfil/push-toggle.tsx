"use client";

import { useState } from "react";
import { assinarPush, cancelarPush } from "@/app/pwa/actions";
import { usePush } from "@/components/push/use-push";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Section } from "@/components/ui/card";

/**
 * O painel de controle de push DESTE aparelho — os banners contextuais vêm e
 * vão, este fica. É também o único caminho de volta documentado depois de um
 * "negar" no prompt nativo: o browser não deixa a página re-perguntar, então o
 * texto ensina o caminho manual.
 *
 * A Section inteira mora aqui dentro (e não na página) porque ela some quando
 * não há suporte: iOS no Safari, browser antigo, ou build sem a chave VAPID —
 * o kill switch padrão do projeto, ver use-push.ts.
 */
export function PushToggle() {
  // Importar as actions aqui é legítimo: este arquivo já mora em src/app/. O
  // que não pode é o hook em src/components/ importá-las — ver use-push.ts.
  const { suportado, permissao, inscritoNesteDevice, ativar, desativar } = usePush({
    aoAssinar: assinarPush,
    aoCancelar: cancelarPush,
  });
  const [estado, setEstado] = useState<"parado" | "trabalhando" | "falhou">("parado");

  if (!suportado) return null;

  return (
    <Section titulo="Avisos no aparelho">
      <Card>
        <CardBody className="flex flex-col gap-3">
          {permissao === "denied" ? (
            <>
              <p className="text-[13px] leading-[1.5] text-fg-2">
                As notificações estão bloqueadas para o FutZenha neste aparelho.
              </p>
              <p className="text-[12px] leading-[1.45] text-fg-4">
                Para voltar a receber: no iPhone, Ajustes → Notificações → FutZenha; no Chrome,
                toca no cadeado ao lado do endereço e libera as notificações. Depois volta aqui.
              </p>
            </>
          ) : inscritoNesteDevice ? (
            <>
              <p className="text-[13px] leading-[1.5] text-fg-2">
                Este aparelho recebe os avisos: vaga aberta, times sorteados, lembrete de
                presença.
              </p>
              <Button
                variante="secondary"
                tamanho="sm"
                className="self-start"
                pending={estado === "trabalhando"}
                onClick={async () => {
                  setEstado("trabalhando");
                  await desativar();
                  setEstado("parado");
                }}
              >
                Desativar neste aparelho
              </Button>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-[1.5] text-fg-2">
                Ativa para saber na hora de vaga aberta, times sorteados e lembrete de presença —
                sem precisar abrir o site.
              </p>
              {estado === "falhou" && (
                <Banner tom="erro">Não deu para ativar. Confere a conexão e tenta de novo.</Banner>
              )}
              <Button
                tamanho="sm"
                className="self-start"
                pending={estado === "trabalhando"}
                onClick={async () => {
                  setEstado("trabalhando");
                  const resultado = await ativar();
                  setEstado(resultado === "erro" ? "falhou" : "parado");
                }}
              >
                Ativar avisos
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
