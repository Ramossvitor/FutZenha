/**
 * O que o chip, o painel e as linhas do seletor precisam combinar entre si.
 *
 * Módulo de constante pura, sem componente e sem `.tsx`, de propósito: o chip e
 * o painel são server, a OpcaoDeGrupo é `"use client"`, e os três precisam do
 * mesmo id. Com as constantes aqui, ninguém importa o módulo de componente do
 * outro só para pegar uma string.
 */

/** Id do painel. Fixo porque o painel é um só — ver PainelDeGrupo. */
export const PAINEL_DE_GRUPO_ID = "seletor-de-grupo";

/** A caixa de uma linha do painel: igual na que troca e na que só fecha. */
export const LINHA_DO_SELETOR =
  "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2";
