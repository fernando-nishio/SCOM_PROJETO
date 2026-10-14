/**
 * Rotas da biblioteca.
 *
 *   POST   /api/biblioteca            guarda um arquivo ja convertido
 *   GET    /api/biblioteca            lista a biblioteca do usuario
 *   GET    /api/biblioteca/:id/arquivo  baixa um item proprio
 *   PATCH  /api/biblioteca/:id        renomeia
 *   DELETE /api/biblioteca/:id        apaga item e arquivo
 *
 * Todas exigem sessao. A verificacao de PROPRIEDADE nao esta aqui: ela
 * mora na clausula WHERE das consultas, em dados/conversao-repo.js.
 * Deixa-la na rota significaria repeti-la em cada caminho novo.
 */

import { Router } from "express";

import * as biblioteca from "../servicos/biblioteca.js";
import { registrar, EVENTOS, ipDaRequisicao } from "../servicos/registro.js";
import { exigirLogin } from "../middlewares/exigir-login.js";
import { receberArquivo } from "../middlewares/upload.js";
import { nomeAscii, sanitizarNomeArquivo } from "../util/formatos.js";

export const rotasBiblioteca = Router();

rotasBiblioteca.use(exigirLogin);

/* ---------------------------------------------------------------------
 *  POST /api/biblioteca
 * ------------------------------------------------------------------- */
rotasBiblioteca.post("/biblioteca", receberArquivo, async (req, res, proximo) => {
	try {
		const item = await biblioteca.guardar({
			usuarioId: req.usuario.id,
			buffer: req.file?.buffer,
			nomeArquivo: req.file?.originalname,
			formatoOrigem: req.body?.formatoOrigem,
			formatoDestino: req.body?.formatoDestino,
			origemConversao: req.body?.origemConversao,
		});

		registrar("info", EVENTOS.ITEM_GUARDADO, {
			usuarioId: req.usuario.id,
			ip: ipDaRequisicao(req),
			detalhe: `id=${item.id} ${item.formatoOrigem}->${item.formatoDestino} ` +
				`(${item.origemConversao}) ${item.tamanhoBytes}B`,
		});

		res.status(201).location(`/api/biblioteca/${item.id}`).json({ item });
	} catch (erro) {
		proximo(erro);
	}
});

/* ---------------------------------------------------------------------
 *  GET /api/biblioteca?pagina=1&porPagina=20
 * ------------------------------------------------------------------- */
rotasBiblioteca.get("/biblioteca", async (req, res, proximo) => {
	try {
		const resultado = await biblioteca.listar(req.usuario.id, {
			pagina: req.query.pagina,
			porPagina: req.query.porPagina,
		});
		res.json(resultado);
	} catch (erro) {
		proximo(erro);
	}
});

/* ---------------------------------------------------------------------
 *  GET /api/biblioteca/:id/arquivo
 *
 *  Os cabecalhos desta resposta sao o ponto de seguranca mais delicado
 *  do projeto. O servidor devolve conteudo que um usuario enviou, a
 *  partir da PROPRIA ORIGEM da aplicacao. Se o navegador resolver
 *  interpretar esse conteudo como HTML, o script dentro dele roda com
 *  acesso ao cookie de sessao - um XSS armazenado.
 *
 *  Tres cabecalhos fecham isso:
 *    Content-Type: application/octet-stream  nao e nada interpretavel
 *    Content-Disposition: attachment         baixa, nao abre
 *    X-Content-Type-Options: nosniff         proibe o navegador de
 *                                            adivinhar o tipo real
 * ------------------------------------------------------------------- */
rotasBiblioteca.get("/biblioteca/:id/arquivo", async (req, res, proximo) => {
	try {
		const { linha, conteudo } = await biblioteca.obterParaDownload(
			req.params.id,
			req.usuario.id,
		);

		// O nome vai sanitizado nos dois formatos. Sem a limpeza, aspas
		// ou quebra de linha no nome permitiriam injetar cabecalhos.
		const nome = sanitizarNomeArquivo(linha.nome_original);
		const ascii = nomeAscii(nome);

		res.set({
			"Content-Type": "application/octet-stream",
			"Content-Disposition":
				`attachment; filename="${ascii}"; ` +
				`filename*=UTF-8''${encodeURIComponent(nome)}`,
			"Content-Length": String(conteudo.length),
			"X-Content-Type-Options": "nosniff",

			// Arquivo de usuario nao pode ficar em cache compartilhado.
			"Cache-Control": "private, no-store",
		});

		res.send(conteudo);
	} catch (erro) {
		proximo(erro);
	}
});

/* ---------------------------------------------------------------------
 *  PATCH /api/biblioteca/:id
 *  PATCH e nao PUT: a requisicao altera um campo, nao substitui o
 *  recurso inteiro.
 * ------------------------------------------------------------------- */
rotasBiblioteca.patch("/biblioteca/:id", async (req, res, proximo) => {
	try {
		const item = await biblioteca.renomear(req.params.id, req.usuario.id, req.body?.nome);
		res.json({ item });
	} catch (erro) {
		proximo(erro);
	}
});

/* ---------------------------------------------------------------------
 *  DELETE /api/biblioteca/:id
 * ------------------------------------------------------------------- */
rotasBiblioteca.delete("/biblioteca/:id", async (req, res, proximo) => {
	try {
		const item = await biblioteca.apagar(req.params.id, req.usuario.id);

		registrar("info", EVENTOS.ITEM_APAGADO, {
			usuarioId: req.usuario.id,
			ip: ipDaRequisicao(req),
			detalhe: `id=${item.id}`,
		});

		res.status(204).end();
	} catch (erro) {
		proximo(erro);
	}
});
