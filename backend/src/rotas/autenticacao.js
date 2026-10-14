/**
 * Rotas de conta e sessao.
 *
 *   POST   /api/contas    cadastro
 *   GET    /api/sessao    quem esta logado (usada pela barra de navegacao)
 *   POST   /api/sessao    login
 *   DELETE /api/sessao    logout
 *
 * A sessao e tratada como recurso: criar e POST, encerrar e DELETE. Fica
 * mais coerente que /login e /logout, que seriam verbos numa URL.
 *
 * Esta camada so faz HTTP: le o corpo, chama o servico, monta a
 * resposta. Nenhuma regra de negocio e nenhum SQL moram aqui.
 */

import { Router } from "express";

import * as autenticacao from "../servicos/autenticacao.js";
import { registrar, EVENTOS, ipDaRequisicao } from "../servicos/registro.js";
import { exigirLogin, carregarUsuarioSeHouver } from "../middlewares/exigir-login.js";
import { limiteAutenticacao } from "../middlewares/limites.js";
import { config } from "../config/index.js";

export const rotasAutenticacao = Router();

/** Formato publico do usuario. Definido uma vez para que nenhuma rota
 *  devolva um campo a mais por descuido. */
function usuarioPublico(usuario) {
	return {
		id: usuario.id,
		nome: usuario.nome,
		email: usuario.email,
		perfil: usuario.perfil,
	};
}

/**
 * Troca o identificador da sessao preservando o conteudo.
 *
 * Chamado no login para evitar FIXACAO DE SESSAO: sem isso, um
 * identificador obtido antes da autenticacao continua valido depois
 * dela, e quem tivesse induzido a vitima a usar aquele identificador
 * herdaria a sessao autenticada.
 */
function regenerarSessao(req) {
	return new Promise((resolver, rejeitar) => {
		req.session.regenerate((erro) => (erro ? rejeitar(erro) : resolver()));
	});
}

function salvarSessao(req) {
	return new Promise((resolver, rejeitar) => {
		req.session.save((erro) => (erro ? rejeitar(erro) : resolver()));
	});
}

/* ---------------------------------------------------------------------
 *  POST /api/contas
 * ------------------------------------------------------------------- */
rotasAutenticacao.post("/contas", limiteAutenticacao, async (req, res, proximo) => {
	try {
		const { nome, email, senha } = req.body ?? {};
		const usuario = await autenticacao.cadastrar({ nome, email, senha });

		registrar("info", EVENTOS.CONTA_CRIADA, {
			usuarioId: usuario.id,
			ip: ipDaRequisicao(req),
			detalhe: `perfil ${usuario.perfil}`,
		});

		// 201 com Location: o recurso foi criado e esta neste endereco.
		res.status(201)
			.location(`/api/usuarios/${usuario.id}`)
			.json({ usuario: usuarioPublico(usuario) });
	} catch (erro) {
		proximo(erro);
	}
});

/* ---------------------------------------------------------------------
 *  POST /api/sessao  (login)
 * ------------------------------------------------------------------- */
rotasAutenticacao.post("/sessao", limiteAutenticacao, async (req, res, proximo) => {
	const ip = ipDaRequisicao(req);

	try {
		const { email, senha } = req.body ?? {};
		const usuario = await autenticacao.verificarCredenciais({ email, senha });

		await regenerarSessao(req);
		req.session.usuarioId = usuario.id;
		await salvarSessao(req);

		registrar("info", EVENTOS.LOGIN_SUCESSO, { usuarioId: usuario.id, ip });

		res.json({ usuario: usuarioPublico(usuario) });
	} catch (erro) {
		// Registra a falha SEM o e-mail tentado: o log e consultavel pela
		// area administrativa, e uma senha digitada no campo de e-mail
		// por engano ficaria gravada em texto puro.
		if (erro.previsto) {
			registrar("aviso", EVENTOS.LOGIN_FALHA, { ip, detalhe: erro.codigo });
		}
		proximo(erro);
	}
});

/* ---------------------------------------------------------------------
 *  GET /api/sessao
 *  Nao usa exigirLogin: a ausencia de sessao e uma resposta valida aqui,
 *  nao um erro. A barra de navegacao chama esta rota para decidir se
 *  mostra "Entrar" ou "Minha biblioteca".
 * ------------------------------------------------------------------- */
rotasAutenticacao.get("/sessao", carregarUsuarioSeHouver, (req, res) => {
	if (!req.usuario) {
		return res.json({ autenticado: false, usuario: null });
	}
	res.json({ autenticado: true, usuario: usuarioPublico(req.usuario) });
});

/* ---------------------------------------------------------------------
 *  DELETE /api/sessao  (logout)
 *
 *  Logout de verdade: a sessao e apagada da tabela, nao apenas esquecida
 *  pelo navegador. Um cookie copiado antes do logout deixa de funcionar.
 *  E a vantagem concreta de sessao em banco sobre JWT, que continuaria
 *  valido ate expirar.
 * ------------------------------------------------------------------- */
rotasAutenticacao.delete("/sessao", exigirLogin, (req, res, proximo) => {
	const usuarioId = req.usuario.id;
	const ip = ipDaRequisicao(req);

	req.session.destroy((erro) => {
		if (erro) return proximo(erro);

		// Sem isto o navegador guarda um cookie que nao aponta mais para
		// nada, e toda requisicao seguinte carrega lixo.
		res.clearCookie(config.sessao.nomeCookie);

		registrar("info", EVENTOS.LOGOUT, { usuarioId, ip });
		res.status(204).end();
	});
});
