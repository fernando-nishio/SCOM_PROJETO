/**
 * Regras de negocio puras.
 *
 * Este arquivo existe por um motivo so: manter testavel, sem banco e sem
 * servidor, aquilo que e decisao de negocio e nao detalhe de
 * persistencia.
 *
 * Uma regra escrita dentro de servicos/admin.js seria igualmente
 * correta, mas aquele modulo importa os repositorios, que importam o
 * driver do PostgreSQL - e entao testar uma comparacao de dois numeros
 * passaria a exigir um banco de pe. Regras que ficam dificeis de testar
 * sao as primeiras a deixar de ser testadas.
 *
 * Criterio para um trecho morar aqui: nao importa nada do projeto alem
 * de util/, e nao conhece HTTP nem SQL.
 */

import { erros } from "./erros.js";

/**
 * Impede que um administrador desative a propria conta.
 *
 * Sem esta trava, um clique errado tranca o ultimo administrador para
 * fora do sistema, e a unica saida passa a ser um UPDATE manual no
 * banco. Reativar a si mesmo continua permitido: isso nao tranca
 * ninguem.
 *
 * @param {{adminId: number, alvoId: number, ativo: boolean}} dados
 */
export function verificarAlteracaoDeConta({ adminId, alvoId, ativo }) {
	if (adminId === alvoId && ativo === false) {
		throw erros.entradaInvalida("Um administrador nao pode desativar a propria conta.", {
			campo: "ativo",
		});
	}
}
