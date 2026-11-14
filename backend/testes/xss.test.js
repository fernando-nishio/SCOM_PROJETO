/**
 * Teste de XSS.
 *
 * O requisito 6 do enunciado exige demonstrar protecao contra XSS
 * refletido. Este arquivo cobre o lado do servidor; o lado do navegador
 * esta na Secao 10 do relatorio, com as capturas da biblioteca exibindo
 * um nome de arquivo malicioso como texto.
 *
 * O ARGUMENTO, em uma frase: o servidor nunca produz HTML. Ele devolve
 * JSON e serve arquivos estaticos, e so. Nao existe template, nao existe
 * concatenacao de HTML, nao existe res.send com texto do usuario. Um
 * payload refletido volta como string dentro de um JSON, com
 * Content-Type application/json e X-Content-Type-Options: nosniff
 * (helmet), de modo que nenhum navegador o interpreta como marcacao.
 *
 * O que sobra, entao, e o XSS armazenado: o nome do arquivo que o
 * usuario escolheu, exibido depois na biblioteca. Esse e responsabilidade
 * do front-end, e o ultimo teste daqui verifica a regra que o protege -
 * nenhum modulo do front-end escreve HTML a partir de dado.
 *
 * Nao precisa de banco nem de rede: as variaveis abaixo existem so para
 * o modulo de configuracao subir, e pool.query e substituida.
 */

process.env.SESSAO_SEGREDO ??= "segredo_apenas_para_teste_com_mais_de_32_caracteres";
process.env.PGDATABASE ??= "freevertio_teste";
process.env.PGUSER ??= "freevertio_teste";
process.env.PGPASSWORD ??= "senha_apenas_para_teste";

// Forcado, e nao ??=, porque um dos testes verifica justamente o que a
// resposta NAO pode conter fora de desenvolvimento (requisito 7).
process.env.NODE_ENV = "production";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { pool } = await import("../src/dados/pool.js");
const { rotaNaoEncontrada, tratadorDeErros } = await import("../src/middlewares/erros.js");
const { ErroApp } = await import("../src/util/erros.js");

// O registro de eventos grava em log_evento sem esperar o resultado.
// Sem banco a gravacao falharia e sujaria a saida do teste; com a
// consulta substituida, ela resolve e nao imprime nada.
pool.query = async () => ({ rows: [], rowCount: 0 });

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/**
 * Remove comentarios antes da varredura.
 *
 * Os proprios arquivos explicam por que nao usam innerHTML, e a frase
 * "textContent, nunca innerHTML" acusaria falso se o texto do
 * comentario entrasse na busca.
 */
function semComentarios(fonte) {
	return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/* ---------------------------------------------------------------------
 *  Cargas
 *
 *  A primeira e a forma classica. A segunda e a que costuma passar por
 *  filtros ingenuos que so procuram a palavra "script": fecha o atributo
 *  e usa um manipulador de evento.
 * ------------------------------------------------------------------- */

const TAG = "<script>alert('xss')</script>";
const ATRIBUTO = '"><img src=x onerror=alert(1)>';

/** Resposta falsa que anota como o corpo foi enviado. */
function respostaFalsa() {
	const r = { status_: null, corpo: null, usouJson: false, usouSend: false };

	r.status = (codigo) => {
		r.status_ = codigo;
		return r;
	};
	r.json = (corpo) => {
		r.usouJson = true;
		r.corpo = corpo;
		return r;
	};
	r.send = (corpo) => {
		r.usouSend = true;
		r.corpo = corpo;
		return r;
	};

	return r;
}

function requisicaoFalsa(caminho) {
	return { method: "GET", path: caminho, ip: "127.0.0.1", session: {} };
}

/* ---------------------------------------------------------------------
 *  XSS refletido
 * ------------------------------------------------------------------- */

test("ATAQUE: payload no caminho volta como dado JSON, nunca como HTML", () => {
	const res = respostaFalsa();
	rotaNaoEncontrada(requisicaoFalsa(`/api/${TAG}`), res);

	assert.equal(res.status_, 404);
	assert.ok(res.usouJson, "a resposta precisa sair por res.json");
	assert.ok(!res.usouSend, "res.send poderia produzir um corpo HTML");

	// O payload realmente volta - e isso nao e falha. Ele volta como
	// VALOR de uma propriedade JSON, e o navegador nao executa valor de
	// JSON. O que o tornaria perigoso seria o corpo ser text/html.
	assert.equal(typeof res.corpo.erro.mensagem, "string");
	assert.ok(res.corpo.erro.mensagem.includes(TAG));
	assert.equal(res.corpo.erro.codigo, "ROTA_NAO_ENCONTRADA");
});

test("ATAQUE: payload de atributo tambem permanece sendo dado", () => {
	const res = respostaFalsa();
	rotaNaoEncontrada(requisicaoFalsa(`/api/${ATRIBUTO}`), res);

	assert.ok(res.usouJson);
	assert.ok(!res.usouSend);
	assert.equal(typeof res.corpo.erro.mensagem, "string");
});

test("erro previsto responde em JSON, com codigo e mensagem", () => {
	const res = respostaFalsa();
	const erro = new ErroApp(400, "ENTRADA_INVALIDA", "O campo e obrigatorio.");

	tratadorDeErros(erro, requisicaoFalsa("/api/contas"), res, () => {});

	assert.equal(res.status_, 400);
	assert.ok(res.usouJson);
	assert.equal(res.corpo.erro.codigo, "ENTRADA_INVALIDA");
});

test("fora de desenvolvimento, defeito nao devolve mensagem interna nem pilha", () => {
	// Requisito 7: detalhes tecnicos apenas em modo de desenvolvimento.
	// Mensagem de excecao costuma conter nome de tabela, caminho de
	// arquivo ou trecho de consulta - informacao gratuita para quem
	// esta sondando o sistema.
	const res = respostaFalsa();
	const defeito = new Error(`falha em /home/varik/S_COM/backend ${TAG}`);

	tratadorDeErros(defeito, requisicaoFalsa("/api/conversoes"), res, () => {});

	assert.equal(res.status_, 500);
	assert.equal(res.corpo.erro.codigo, "ERRO_INTERNO");
	assert.equal(res.corpo.erro.mensagem, "Ocorreu um erro interno. Tente novamente.");
	assert.equal(res.corpo.erro.excecao, undefined);
	assert.equal(res.corpo.erro.pilha, undefined);
	assert.ok(!JSON.stringify(res.corpo).includes(TAG));
});

/* ---------------------------------------------------------------------
 *  XSS armazenado: a regra que o impede
 * ------------------------------------------------------------------- */

test("nenhum modulo do front-end escreve HTML a partir de dado", () => {
	// Esta e a protecao de verdade contra o XSS armazenado. O nome do
	// arquivo vem do usuario e aparece na biblioteca; com textContent o
	// navegador o trata como texto, e um nome com <script> aparece como
	// um nome feio em vez de virar codigo.
	const PROIBIDOS = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("];
	const pasta = path.join(AQUI, "..", "..", "frontend", "js");

	for (const arquivo of fs.readdirSync(pasta)) {
		const fonte = fs.readFileSync(path.join(pasta, arquivo), "utf8");

		const codigo = semComentarios(fonte);

		for (const proibido of PROIBIDOS) {
			assert.ok(
				!codigo.includes(proibido),
				`${arquivo}: usa ${proibido}, que interpreta dado como marcacao`,
			);
		}
	}
});

test("nenhuma rota monta corpo de resposta com res.send", () => {
	// Guarda de regressao: res.json escapa o valor e marca o corpo como
	// application/json. Um res.send com texto montado abriria a porta
	// que os testes acima fecham.
	const pasta = path.join(AQUI, "..", "src", "rotas");

	for (const arquivo of fs.readdirSync(pasta)) {
		const fonte = fs.readFileSync(path.join(pasta, arquivo), "utf8");
		const codigo = semComentarios(fonte);

		assert.ok(
			!/res\.send\s*\(\s*[`"']/.test(codigo),
			`${arquivo}: res.send com texto literal pode produzir HTML`,
		);
	}
});
