import { LinkButton } from "@/components/ui/button";
import { IconeCampo } from "@/components/ui/icons";

export default function NotFound() {
  return (
    <div className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-4 text-center">
      <IconeCampo className="size-12 text-line-strong" />
      <h1 className="font-display text-[26px] leading-[1.05] font-black font-stretch-125% text-fg uppercase">
        Essa bola saiu
        <br />
        de campo
      </h1>
      <p className="text-[14px] leading-[1.55] text-fg-3">
        A página que você procura não existe. Se você chegou por um link antigo, pode ser que o
        fut ou o grupo tenham sido apagados.
      </p>
      <LinkButton href="/" variante="primary">
        Voltar para o início
      </LinkButton>
    </div>
  );
}
