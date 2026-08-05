import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <p className="text-5xl">🥅</p>
      <h1 className="text-2xl font-bold">Essa bola saiu de campo</h1>
      <p className="text-neutral-500">A página que você procura não existe.</p>
      <Link
        href="/"
        className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
      >
        Voltar para o início
      </Link>
    </div>
  );
}
