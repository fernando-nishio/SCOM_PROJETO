/**
 * Testes do filtro de upload.
 *
 * Nasceram de um defeito real: o filtro recusava nomes de arquivo longos
 * demais lancando um Error comum. O tratador central nao o reconhecia
 * como erro previsto, e o que era erro de quem enviou virava
 * 500 ERRO_INTERNO - com direito a linha de nivel ERRO no log, como se o
 * servidor tivesse falhado. O ultimo teste reproduz exatamente esse
 * caminho.
 *
 * Nao precisa de banco: as variaveis abaixo existem so para o modulo de
 * configuracao subir, e nenhuma conexao e aberta.
 */

process.env.SESSAO_SEGREDO ??= "segredo_apenas_para_teste_com_mais_de_32_caracteres";
process.env.PGDATABASE ??= "freevertio_teste";
process.env.PGUSER ??= "freevertio_teste";
process.env.PGPASSWORD ??= "senha_apenas_para_teste";

import test from "node:test";
import assert from "node:assert/strict";

const { pool } = await import("../src/dados/pool.js");
const { filtrarArquivo, NOME_MAX_CARACTERES } = await import("../src/middlewares/upload.js");
const { tratadorDeErros } = await import("../src/middlewares/erros.js");

// Um 500 tentaria gravar em log_evento. Sem banco, a gravacao so
// sujaria a saida; com a consulta substituida, ela resolve em silencio.
pool.query = async () => ({ rows: [], rowCount: 0 });

/** Chama o filtro e devolve o que ele passou ao callback. */
function filtrar(nome) {
	let resultado = null;
	filtrarArquivo({}, { originalname: nome }, (erro, aceito) => {
		resultado = { erro: erro ?? null, aceito: aceito ?? false };
	});
	return resultado;
}

test("nome no limite e aceito", () => {
	const { erro, aceito } = filtrar("a".repeat(NOME_MAX_CARACTERES - 4) + ".png");

	assert.equal(erro, null);
	assert.equal(aceito, true);
});

test("nome acima do limite e recusado com 400, e nao com erro generico", () => {
	const { erro } = filtrar("a".repeat(NOME_MAX_CARACTERES) + ".png");

	assert.ok(erro, "o filtro deveria recusar");
	assert.equal(erro.previsto, true, "a recusa precisa ser um erro previsto");
	assert.equal(erro.status, 400);
	assert.equal(erro.codigo, "ENTRADA_INVALIDA");
});

test("arquivo sem nome passa pelo filtro e fica para a validacao de conteudo", () => {
	// O filtro so trata o nome. Arquivo sem nome nao e problema dele: a
	// rota recusa logo depois, por falta de extensao.
	const { erro, aceito } = filtrar(undefined);

	assert.equal(erro, null);
	assert.equal(aceito, true);
});

test("o tratador central responde 400 a recusa do filtro, e nao 500", () => {
	const { erro } = filtrar("x".repeat(NOME_MAX_CARACTERES + 1));

	const res = {
		status(codigo) { this.codigo = codigo; return this; },
		json(corpo) { this.corpo = corpo; return this; },
	};
	tratadorDeErros(erro, { method: "POST", path: "/api/conversoes", session: {} }, res, () => {});

	assert.equal(res.codigo, 400);
	assert.equal(res.corpo.erro.codigo, "ENTRADA_INVALIDA");
});
