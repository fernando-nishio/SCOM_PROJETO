/**
 * Autorizacao por perfil.
 *
 * Usar SEMPRE depois de exigirLogin, que e quem preenche req.usuario:
 *
 *     rotas.get("/admin/usuarios", exigirLogin, exigirPerfil("admin"), listar);
 *
 * Este middleware cobre permissao por PAPEL ("admin pode ver os logs").
 * Nao cobre permissao por PROPRIEDADE ("este item e meu") - essa mora na
 * clausula WHERE das consultas.
 */

import { erros } from "../util/erros.js";

/**
 * @param {...string} perfisPermitidos
 */
export function exigirPerfil(...perfisPermitidos) {
	if (perfisPermitidos.length === 0) {
		// Erro de programacao, detectado na montagem das rotas e nao em
		// producao: um middleware sem perfis liberaria qualquer um.
		throw new Error("exigirPerfil precisa de ao menos um perfil.");
	}

	const permitidos = new Set(perfisPermitidos);

	return function verificarPerfil(req, res, proximo) {
		// Sem req.usuario, alguem esqueceu o exigirLogin na frente. Negar
		// e o comportamento seguro: na duvida, nao autoriza.
		if (!req.usuario) {
			return proximo(erros.naoAutenticado());
		}

		if (!permitidos.has(req.usuario.perfil)) {
			return proximo(erros.semPermissao());
		}

		proximo();
	};
}
