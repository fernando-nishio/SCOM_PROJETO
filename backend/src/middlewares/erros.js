/**
 * Tratamento centralizado de erros.
 *
 * As rotas nao montam resposta de erro: elas lancam (ou chamam next com
 * o erro) e este modulo formata. Vantagem concreta: o formato da
 * resposta de erro e definido em um lugar so, entao o cliente pode
 * confiar nele sempre.
 *
 * Registrar por ULTIMO no servidor.js, depois de todas as rotas.
 */

import { config } from "../config/index.js";
import { ErroApp } from "../util/erros.js";
import { registrar, EVENTOS, ipDaRequisicao } from "../servicos/registro.js";

/**
 * Rota inexistente. Vem antes do tratador de erros e so transforma o
 * caso em um ErroApp, para que a resposta tenha o mesmo formato das
 * demais.
 */
export function rotaNaoEncontrada(req, res) {
	res.status(404).json({
		erro: {
			codigo: "ROTA_NAO_ENCONTRADA",
			mensagem: `Nao existe ${req.method} ${req.path}.`,
		},
	});
}

/**
 * Converte erros conhecidos de bibliotecas em ErroApp, para que o
 * usuario receba uma mensagem util em vez de um 500 generico.
 */
function traduzir(erro) {
	// multer: upload acima do limite configurado
	if (erro.code === "LIMIT_FILE_SIZE") {
		const limiteMb = Math.round(config.upload.tamanhoMaximoBytes / 1024 / 1024);
		return new ErroApp(
			413,
			"ARQUIVO_GRANDE_DEMAIS",
			`O arquivo excede o limite de ${limiteMb} MB.`,
		);
	}

	// pg: violacao de UNIQUE
	if (erro.code === "23505") {
		return new ErroApp(409, "JA_EXISTE", "Este registro ja existe.");
	}

	// pg: violacao de CHECK ou de FK
	if (erro.code === "23514" || erro.code === "23503") {
		return new ErroApp(400, "ENTRADA_INVALIDA", "Os dados enviados sao invalidos.");
	}

	// pg: banco fora do ar
	if (erro.code === "ECONNREFUSED" || erro.code === "57P01") {
		return new ErroApp(
			503,
			"BANCO_INDISPONIVEL",
			"O servico esta temporariamente indisponivel.",
		);
	}

	// JSON malformado no corpo da requisicao
	if (erro.type === "entity.parse.failed") {
		return new ErroApp(400, "JSON_INVALIDO", "O corpo da requisicao nao e um JSON valido.");
	}

	return null;
}

/* eslint-disable-next-line no-unused-vars -- o Express so reconhece um
   tratador de erro se a funcao declarar os QUATRO parametros. */
export function tratadorDeErros(erro, req, res, next) {
	const traduzido = erro.previsto ? erro : (traduzir(erro) ?? erro);
	const previsto = traduzido.previsto === true;

	const status = previsto ? traduzido.status : 500;
	const codigo = previsto ? traduzido.codigo : "ERRO_INTERNO";

	// Falha prevista descreve o que o usuario fez de errado e pode ser
	// mostrada. Defeito nao: a mensagem original pode conter nome de
	// tabela, caminho de arquivo ou trecho de consulta.
	const mensagem = previsto
		? traduzido.message
		: "Ocorreu um erro interno. Tente novamente.";

	// Defeito e sempre registrado; falha prevista so quando for negativa
	// de acesso, que interessa para auditoria.
	if (!previsto) {
		registrar("erro", EVENTOS.ERRO_INTERNO, {
			usuarioId: req.session?.usuarioId ?? null,
			ip: ipDaRequisicao(req),
			detalhe: `${req.method} ${req.path} :: ${erro.message}`,
		});
		console.error(erro.stack);
	} else if (status === 401 || status === 403) {
		registrar("aviso", EVENTOS.ACESSO_NEGADO, {
			usuarioId: req.session?.usuarioId ?? null,
			ip: ipDaRequisicao(req),
			detalhe: `${req.method} ${req.path} :: ${codigo}`,
		});
	}

	const corpo = { erro: { codigo, mensagem } };

	// Detalhes tecnicos SOMENTE em desenvolvimento. Em producao eles vao
	// para o log; mensagem de erro detalhada e informacao gratuita para
	// quem esta sondando o sistema.
	if (config.desenvolvimento) {
		if (traduzido.detalhes) corpo.erro.detalhes = traduzido.detalhes;
		if (!previsto) {
			corpo.erro.excecao = erro.message;
			corpo.erro.pilha = erro.stack?.split("\n").slice(0, 5);
		}
	}

	res.status(status).json(corpo);
}
