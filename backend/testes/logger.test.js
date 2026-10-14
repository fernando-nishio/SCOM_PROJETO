/**
 * Testes do formatador de logs.
 *
 * Executar com:  npm test
 *
 * Estes testes nao precisam de banco nem de servidor HTTP - e exatamente
 * por isso que util/logger.js nao importa nada do projeto. Logica pura e
 * logica testavel.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { formatar, limpar, escrever } from "../src/util/logger.js";

test("limpar omite campos sensiveis em qualquer profundidade", () => {
	const entrada = {
		email: "a@b.c",
		senha: "segredo",
		corpo: { password: "x", nome: "ok" },
	};

	const saida = limpar(entrada);

	assert.equal(saida.senha, "[omitido]");
	assert.equal(saida.corpo.password, "[omitido]");
	assert.equal(saida.email, "a@b.c", "campo nao sensivel deve ser preservado");
	assert.equal(saida.corpo.nome, "ok");
});

test("limpar atravessa arrays", () => {
	const saida = limpar([{ token: "abc" }, { nome: "ok" }]);

	assert.equal(saida[0].token, "[omitido]");
	assert.equal(saida[1].nome, "ok");
});

test("formatar monta a linha com timestamp, nivel, evento, usuario e ip", () => {
	const linha = formatar("info", "login_sucesso", {
		usuarioId: 3,
		ip: "127.0.0.1",
		detalhe: "ok",
	});

	assert.match(linha, /^\d{4}-\d{2}-\d{2}T/, "deve comecar com timestamp ISO");
	assert.match(linha, /\[INFO \] login_sucesso usuario=3 ip=127\.0\.0\.1 \| ok$/);
});

test("formatar nunca deixa senha vazar pelo contexto extra", () => {
	const linha = formatar("erro", "falha", { senha: "umaSenhaQualquer", tentativa: 2 });

	assert.ok(!linha.includes("umaSenhaQualquer"), "a senha nao pode aparecer no log");
	assert.match(linha, /\[omitido\]/);
});

test("formatar omite campos ausentes em vez de escrever null", () => {
	const linha = formatar("info", "evento_simples");

	assert.ok(!linha.includes("usuario="));
	assert.ok(!linha.includes("ip="));
	assert.ok(!linha.includes("undefined"));
});

test("escrever rejeita nivel invalido", () => {
	assert.throws(() => escrever("critico", "x"), /Nivel de log invalido/);
});
