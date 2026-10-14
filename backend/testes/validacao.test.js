/**
 * Testes da camada de validacao.
 *
 * Cobrem casos validos E invalidos, como o enunciado exige. Nenhum deles
 * precisa de banco: validacao e logica pura, e manter assim e o que
 * permite testa-la sem infraestrutura.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
	validarNome,
	validarEmail,
	validarSenha,
	validarIdentificador,
	LIMITES,
} from "../src/util/validacao.js";

/* --- nome ---------------------------------------------------------- */

test("validarNome aceita nome valido e remove espacos das bordas", () => {
	assert.equal(validarNome("  Fernando Nishio  "), "Fernando Nishio");
});

test("validarNome rejeita vazio, curto demais e longo demais", () => {
	assert.throws(() => validarNome(""), /pelo menos/);
	assert.throws(() => validarNome("   "), /pelo menos/);
	assert.throws(() => validarNome("A"), /pelo menos/);
	assert.throws(() => validarNome("x".repeat(LIMITES.NOME_MAX + 1)), /no maximo/);
});

test("validarNome rejeita tipo diferente de texto", () => {
	assert.throws(() => validarNome(42), /obrigatorio/);
	assert.throws(() => validarNome(null), /obrigatorio/);
	assert.throws(() => validarNome({ nome: "x" }), /obrigatorio/);
});

/* --- email --------------------------------------------------------- */

test("validarEmail normaliza para minusculas e sem espacos", () => {
	assert.equal(validarEmail("  Fulano@Exemplo.COM "), "fulano@exemplo.com");
});

test("validarEmail rejeita enderecos malformados", () => {
	for (const invalido of [
		"semarroba.com",
		"@semlocal.com",
		"sem@dominio",
		"dois@@arrobas.com",
		"com espaco@exemplo.com",
		"",
	]) {
		assert.throws(() => validarEmail(invalido), /valido|obrigatorio/, `aceitou "${invalido}"`);
	}
});

/* --- senha --------------------------------------------------------- */

test("validarSenha aceita senha no limite minimo", () => {
	const senha = "a".repeat(LIMITES.SENHA_MIN);
	assert.equal(validarSenha(senha), senha);
});

test("validarSenha NAO altera a senha: espaco nas bordas faz parte dela", () => {
	assert.equal(validarSenha("  senha com espacos  "), "  senha com espacos  ");
});

test("validarSenha rejeita senha curta", () => {
	assert.throws(() => validarSenha("a".repeat(LIMITES.SENHA_MIN - 1)), /pelo menos/);
});

test("validarSenha conta BYTES, nao caracteres, no limite do bcrypt", () => {
	// 72 caracteres ASCII = 72 bytes: no limite, aceito.
	assert.doesNotThrow(() => validarSenha("a".repeat(72)));

	// 24 emojis ocupam 96 bytes em UTF-8 - o bcrypt truncaria em
	// silencio, entao a senha precisa ser recusada.
	//
	// Repare na diferenca entre as tres contagens do mesmo texto: 24
	// simbolos, 48 unidades UTF-16 (cada emoji e um par substituto, e e
	// isso que .length conta) e 96 bytes. So a contagem em bytes
	// corresponde ao que o bcrypt enxerga.
	const emojis = "🔐".repeat(24);
	assert.equal([...emojis].length, 24, "24 simbolos");
	assert.equal(emojis.length, 48, "48 unidades UTF-16");
	assert.equal(Buffer.byteLength(emojis, "utf8"), 96, "96 bytes");
	assert.ok(Buffer.byteLength(emojis, "utf8") > LIMITES.SENHA_MAX_BYTES);
	assert.throws(() => validarSenha(emojis), /bytes/);
});

/* --- identificador ------------------------------------------------- */

test("validarIdentificador aceita inteiro positivo em texto ou numero", () => {
	assert.equal(validarIdentificador("42"), 42);
	assert.equal(validarIdentificador(7), 7);
});

test("validarIdentificador rejeita o que nao e inteiro positivo", () => {
	for (const invalido of ["0", "-1", "1.5", "abc", "1e3", "", "  ", null, "1; DROP TABLE usuario"]) {
		assert.throws(
			() => validarIdentificador(invalido),
			/inteiro positivo/,
			`aceitou ${JSON.stringify(invalido)}`,
		);
	}
});
