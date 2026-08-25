import { definirAvisosPorEmail } from "./actions";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, Section } from "@/components/ui/card";

/**
 * A porta de saída dos avisos por e-mail.
 *
 * Server Component com dois <form>, no molde do MovimentoToggle ao lado: sem
 * client state, sem JS, e a escolha grava direto em `users.avisos_por_email`.
 *
 * O texto diz o que CONTINUA chegando, e não só o que para. Sem isso, "desligar
 * avisos por e-mail" é lido como "não recebo mais nada do FutZenha" — e a pessoa
 * que desligar esperando isso vai tratar o próximo comprovante de recarga como
 * e-mail que não devia ter chegado, que é justamente a leitura que este toggle
 * existe para evitar. Ver AVISOS_POR_EMAIL em src/lib/email-avisos.ts para a
 * lista dos que ignoram esta escolha.
 */
export function AvisosPorEmailToggle({ ligado, para }: { ligado: boolean; para: string | null }) {
  return (
    <Section titulo="Avisos por e-mail">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <p className="text-[13px] leading-[1.5] text-fg-2">
            {ligado
              ? "Convite para um fut, lembrete de véspera, votação para excluir um fut e pedido para entrar no seu grupo também chegam por e-mail."
              : "Esses avisos só aparecem no app. Comprovante de recarga, recibo de compra e avisos de segurança da conta continuam chegando por e-mail — eles não são desligáveis."}
          </p>
          {para === null ? (
            // Sem endereço não há o que ligar nem desligar, e um botão que não
            // muda nada é pior que a explicação de por quê. O campo de e-mail de
            // contato fica logo acima, na seção "Acesso".
            <p className="text-[13px] leading-[1.5] text-fg-3">
              Sua conta não tem e-mail cadastrado, então nenhum aviso sai por e-mail. Informe um
              e-mail de contato acima para receber.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <form action={definirAvisosPorEmail.bind(null, !ligado)}>
                <SubmitButton variante={ligado ? "secondary" : "primary"} tamanho="sm">
                  {ligado ? "Desligar" : "Ligar"}
                </SubmitButton>
              </form>
              <span className="text-[13px] text-fg-3">
                Enviamos para <strong className="text-fg-2">{para}</strong>.
              </span>
            </div>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
