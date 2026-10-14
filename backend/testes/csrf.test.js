/**
 * Testes da protecao CSRF.
 *
 * O middleware precisa de req/res/next, mas eles sao objetos simples -
 * nao e preciso subir um servidor HTTP para exercita-lo. Os dois ultimos
 * testes sao tentativas de ataque documentadas.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { obterToken, verificarCsrf, _interno } from "../src/middlewares/csrf.js";

const { iguais } = _interno;

/** Requisicao de mentira, com o minimo que o middleware consulta. */
function criarReq({ metodo = "POST", sessao = {}, cabecalhos = {}, corpo = {} } = {}) {
	const normalizados = Object.fromEntries(
		Object.entries(cabecalhos).map(([k, v]) => [k.toLowerCase(), v]),
	);
	return {
		method: metodo,
		session: sessao,
		body: corpo,
		get: (nome) => normalizados[nome.toLowerCase()],
	};
}

/** Executa o middleware e devolve o erro passado ao next, ou null. */
function executar(req) {
	let resultado = null;
	verificarCsrf(req, {}, (erro) => {
		resultado = erro ?? null;
	});
	return resultado;
}

/* --- comparacao em tempo constante --------------------------------- */

test("iguais compara corretamente e rejeita vazio", () => {
	assert.ok(iguais("abc123", "abc123"));
	assert.ok(!iguais("abc123", "abc124"));
	assert.ok(!iguais("abc", "abcd"), "comprimentos diferentes");
	assert.ok(!iguais("", ""), "token vazio nunca vale");
	assert.ok(!iguais(undefined, "abc"));
	assert.ok(!iguais(null, null));
});

/* --- geracao do token ---------------------------------------------- */

test("obterToken gera um token e o reaproveita na mesma sessao", () => {
	const sessao = {};
	const primeiro = obterToken({ session: sessao });

	assert.equal(typeof primeiro, "string");
	assert.equal(primeiro.length, 64, "32 bytes em hexadecimal");
	assert.equal(obterToken({ session: sessao }), primeiro);
});

test("sessoes diferentes recebem tokens diferentes", () => {
	const a = obterToken({ session: {} });
	const b = obterToken({ session: {} });
	assert.notEqual(a, b);
});

test("obterToken falha sem sessao configurada", () => {
	assert.throws(() => obterToken({}), /exige sessao/);
});

/* --- comportamento do middleware ----------------------------------- */

test("metodos de leitura passam sem token", () => {
	for (const metodo of ["GET", "HEAD", "OPTIONS"]) {
		const req = criarReq({ metodo, sessao: { usuarioId: 1, csrfToken: "x" } });
		assert.equal(executar(req), null, `${metodo} deveria passar`);
	}
});

test("requisicao anonima passa: sem sessao nao ha o que falsificar", () => {
	// E o caso do proprio login - por isso ele nao precisa de token.
	const req = criarReq({ metodo: "POST", sessao: {} });
	assert.equal(executar(req), null);
});

test("requisicao autenticada com token correto passa", () => {
	const sessao = { usuarioId: 1 };
	const token = obterToken({ session: sessao });

	const req = criarReq({ sessao, cabecalhos: { "X-CSRF-Token": token } });
	assert.equal(executar(req), null);
});

test("ATAQUE: requisicao autenticada sem token nenhum e recusada", () => {
	const sessao = { usuarioId: 1 };
	obterToken({ session: sessao });

	// E exatamente isso que um formulario em site de terceiro produz: o
	// navegador manda o cookie, mas o atacante nao tem como ler o token.
	const erro = executar(criarReq({ sessao }));

	assert.ok(erro, "deveria ter sido recusada");
	assert.equal(erro.codigo, "CSRF_INVALIDO");
	assert.equal(erro.status, 403);
});

test("ATAQUE: token de outra sessao nao serve", () => {
	const sessaoVitima = { usuarioId: 1 };
	obterToken({ session: sessaoVitima });

	const tokenDoAtacante = obterToken({ session: { usuarioId: 2 } });

	const erro = executar(
		criarReq({ sessao: sessaoVitima, cabecalhos: { "X-CSRF-Token": tokenDoAtacante } }),
	);

	assert.ok(erro);
	assert.equal(erro.codigo, "CSRF_INVALIDO");
});

test("o token tambem pode vir no corpo, para formularios sem JavaScript", () => {
	const sessao = { usuarioId: 1 };
	const token = obterToken({ session: sessao });

	assert.equal(executar(criarReq({ sessao, corpo: { _csrf: token } })), null);
});

test("DELETE e PATCH tambem exigem token", () => {
	for (const metodo of ["DELETE", "PATCH", "PUT"]) {
		const sessao = { usuarioId: 1 };
		obterToken({ session: sessao });

		const erro = executar(criarReq({ metodo, sessao }));
		assert.ok(erro, `${metodo} deveria exigir token`);
	}
});
