/**
 * Autenticacao: existe sessao valida?
 *
 * Responde a PRIMEIRA das duas perguntas do controle de acesso. A
 * segunda - "esta sessao pode agir sobre ESTE registro?" - e respondida
 * nas consultas, com o dono como condicao de busca. Ver
 * docs/permissoes.md.
 */

import { erros } from "../util/erros.js";
import * as usuarioRepo from "../dados/usuario-repo.js";

/**
 * Exige sessao ativa e carrega o usuario em req.usuario.
 *
 * O usuario e lido do BANCO a cada requisicao, e nao da sessao. Custa
 * uma busca por chave primaria - a consulta mais barata que existe - e
 * paga por duas garantias:
 *
 *   - uma conta desativada perde o acesso na proxima requisicao, sem
 *     precisar esperar a sessao expirar;
 *   - uma mudanca de perfil vale imediatamente, em vez de ficar presa a
 *     um valor copiado na sessao no momento do login.
 *
 * Guardar o perfil na sessao economizaria essa busca e criaria uma
 * janela em que o sistema age com permissoes que o banco ja revogou.
 */
export async function exigirLogin(req, res, proximo) {
	const usuarioId = req.session?.usuarioId;

	if (!usuarioId) {
		return proximo(erros.naoAutenticado());
	}

	try {
		const usuario = await usuarioRepo.buscarPorId(usuarioId);

		// Sessao aponta para usuario que nao existe mais: destroi o
		// vestigio em vez de deixar um cookie orfao circulando.
		if (!usuario) {
			return req.session.destroy(() => proximo(erros.sessaoExpirada()));
		}

		if (!usuario.ativo) {
			return req.session.destroy(() => proximo(erros.semPermissao()));
		}

		req.usuario = usuario;
		proximo();
	} catch (erro) {
		proximo(erro);
	}
}

/**
 * Nao exige sessao, mas carrega o usuario quando houver uma.
 *
 * Para rotas que atendem anonimo e logado com comportamentos
 * diferentes - converter no servidor funciona sem conta, mas so quem
 * esta logado pode pedir para guardar o resultado.
 */
export async function carregarUsuarioSeHouver(req, res, proximo) {
	const usuarioId = req.session?.usuarioId;

	if (!usuarioId) {
		req.usuario = null;
		return proximo();
	}

	try {
		const usuario = await usuarioRepo.buscarPorId(usuarioId);
		req.usuario = usuario?.ativo ? usuario : null;
		proximo();
	} catch (erro) {
		proximo(erro);
	}
}
