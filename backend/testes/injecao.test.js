/**
 * Teste de injecao de SQL.
 *
 * Quinto dos ataques exigidos pelo enunciado, e o unico que nao pode ser
 * demonstrado com uma requisicao: uma injecao bem-sucedida apareceria no
 * SQL que o driver recebe, nao na resposta HTTP. Entao e ali que este
 * arquivo olha.
 *
 * COMO FUNCIONA, sem banco e sem rede: pool.query e substituida por uma
 * funcao que apenas guarda o texto da consulta e a lista de valores, e
 * devolve um resultado vazio. Cada teste chama uma funcao real de
 * dados/ com uma carga maliciosa e verifica duas coisas:
 *
 *     1. a carga NAO aparece no texto do comando;
 *     2. a carga aparece inteira na lista de valores.
 *
 * As duas juntas sao a definicao de consulta parametrizada: o banco
 * recebe o comando e os dados por canais separados e nunca reanalisa o
 * dado como sintaxe. Nao e escape - nao ha nada para escapar.
 *
 * O teste nao precisa de PostgreSQL: as variaveis de ambiente abaixo
 * existem so para o modulo de configuracao subir, e nenhuma conexao
 * chega a ser aberta.
 */

process.env.SESSAO_SEGREDO ??= "segredo_apenas_para_teste_com_mais_de_32_caracteres";
process.env.PGDATABASE ??= "freevertio_teste";
process.env.PGUSER ??= "freevertio_teste";
process.env.PGPASSWORD ??= "senha_apenas_para_teste";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { pool } = await import("../src/dados/pool.js");
const usuarios = await import("../src/dados/usuario-repo.js");
const conversoes = await import("../src/dados/conversao-repo.js");
const { validarIdentificador, validarEmail } = await import("../src/util/validacao.js");

/* ---------------------------------------------------------------------
 *  Cargas usadas nos testes
 *
 *  A primeira e a classica de autenticacao: fecha a aspa, satisfaz a
 *  condicao e comenta o resto da linha. A segunda encerra o comando e
 *  emenda outro. A terceira ataca a paginacao, que e onde o SQL costuma
 *  ser montado por concatenacao mesmo em codigo que parametriza o resto.
 * ------------------------------------------------------------------- */

const SEMPRE_VERDADEIRO = "' OR 1=1 --";
const APAGA_TABELA = "'; DROP TABLE conversao; --";
const PAGINACAO = "10; DROP TABLE usuario";

/**
 * Executa a funcao com pool.query substituida e devolve o que o driver
 * teria recebido.
 */
async function capturar(executar) {
	let chamada = null;

	const eraPropria = Object.hasOwn(pool, "query");
	const anterior = pool.query;

	pool.query = async (texto, valores) => {
		chamada = { texto, valores: valores ?? [] };
		// Estrutura minima que as funcoes de dados/ sabem ler.
		return { rows: [{ total: 0 }], rowCount: 0 };
	};

	try {
		await executar();
	} finally {
		if (eraPropria) pool.query = anterior;
		else delete pool.query;
	}

	assert.ok(chamada, "nenhuma consulta chegou ao driver");
	return chamada;
}

/** Marcadores distintos usados no comando: $1, $2, ... */
function marcadores(texto) {
	return new Set(texto.match(/\$\d+/g) ?? []);
}

/* ---------------------------------------------------------------------
 *  O contraste: como seria se a consulta fosse montada por concatenacao
 * ------------------------------------------------------------------- */

test("a forma vulneravel transformaria a carga em sintaxe", () => {
	// Esta funcao NAO existe no projeto. Esta aqui para mostrar o que o
	// banco receberia se existisse - e e exatamente contra isto que os
	// testes seguintes se asseguram.
	const vulneravel = (email) =>
		`SELECT id FROM usuario WHERE email = '${email}'`;

	const comando = vulneravel(SEMPRE_VERDADEIRO);

	// A carga virou parte do comando: a condicao passou a ser sempre
	// verdadeira e o resto da linha virou comentario.
	assert.match(comando, /OR 1=1/);
	assert.match(comando, /--/);
});

/* ---------------------------------------------------------------------
 *  Autenticacao
 * ------------------------------------------------------------------- */

test("login: a carga vai como valor, nunca como comando", async () => {
	const { texto, valores } = await capturar(() =>
		usuarios.buscarPorEmailParaLogin(SEMPRE_VERDADEIRO),
	);

	assert.ok(!texto.includes("OR 1=1"), "a carga vazou para o texto do comando");
	assert.ok(!texto.includes("--"), "a carga vazou para o texto do comando");
	assert.deepEqual(valores, [SEMPRE_VERDADEIRO]);

	// O e-mail entra por um marcador, e e o unico parametro da consulta.
	assert.deepEqual(marcadores(texto), new Set(["$1"]));
});

test("cadastro: aspas e ponto-e-virgula no nome continuam sendo nome", async () => {
	const { texto, valores } = await capturar(() =>
		usuarios.criar({
			nome: APAGA_TABELA,
			email: "alguem@exemplo.com",
			senhaHash: "$2a$12$hash_qualquer",
			perfil: "usuario",
		}),
	);

	assert.ok(!texto.includes("DROP TABLE"));
	assert.equal(valores[0], APAGA_TABELA);
});

/* ---------------------------------------------------------------------
 *  Biblioteca
 * ------------------------------------------------------------------- */

test("renomear: DROP TABLE no nome do arquivo e so um nome esquisito", async () => {
	const { texto, valores } = await capturar(() =>
		conversoes.renomear(7, 3, APAGA_TABELA),
	);

	assert.ok(!texto.includes("DROP TABLE"));
	assert.equal(valores[2], APAGA_TABELA);
});

test("paginacao: limite e deslocamento tambem sao parametros", async () => {
	// LIMIT e OFFSET sao o ponto que mais escapa, porque sao numeros e a
	// tentacao de interpolar e grande.
	const { texto, valores } = await capturar(() =>
		conversoes.listarDoUsuario(3, { limite: PAGINACAO, deslocamento: 0 }),
	);

	assert.ok(!texto.includes("DROP TABLE"));
	assert.match(texto, /LIMIT \$2 OFFSET \$3/);
	assert.equal(valores[1], PAGINACAO);
});

test("a consulta de um item leva o dono como condicao de busca", async () => {
	// Nao e assunto de injecao, e sim de autorizacao - mas e a mesma
	// consulta, entao vale verificar aqui que o filtro nao sumiu.
	const { texto, valores } = await capturar(() =>
		conversoes.buscarDoUsuario(7, 3),
	);

	assert.match(texto, /WHERE id = \$1 AND usuario_id = \$2/);
	assert.deepEqual(valores, [7, 3]);
});

/* ---------------------------------------------------------------------
 *  Varredura: toda funcao de dados/ que recebe entrada externa
 * ------------------------------------------------------------------- */

const CHAMADAS = [
	["usuario.buscarPorEmailParaLogin", () => usuarios.buscarPorEmailParaLogin(SEMPRE_VERDADEIRO)],
	["usuario.buscarPorId", () => usuarios.buscarPorId(SEMPRE_VERDADEIRO)],
	["usuario.existeEmail", () => usuarios.existeEmail(SEMPRE_VERDADEIRO)],
	["usuario.listar", () => usuarios.listar({ limite: PAGINACAO, deslocamento: APAGA_TABELA })],
	["usuario.definirAtivo", () => usuarios.definirAtivo(APAGA_TABELA, false)],
	["conversao.listarDoUsuario", () => conversoes.listarDoUsuario(SEMPRE_VERDADEIRO)],
	["conversao.contarDoUsuario", () => conversoes.contarDoUsuario(SEMPRE_VERDADEIRO)],
	["conversao.buscarDoUsuario", () => conversoes.buscarDoUsuario(APAGA_TABELA, SEMPRE_VERDADEIRO)],
	["conversao.renomear", () => conversoes.renomear(1, 1, APAGA_TABELA)],
	["conversao.apagar", () => conversoes.apagar(APAGA_TABELA, SEMPRE_VERDADEIRO)],
	["conversao.apagarQualquer", () => conversoes.apagarQualquer(APAGA_TABELA)],
	["conversao.listarTodas", () => conversoes.listarTodas({ limite: PAGINACAO, deslocamento: 0 })],
];

for (const [nome, chamada] of CHAMADAS) {
	test(`${nome}: nenhuma carga alcanca o texto do comando`, async () => {
		const { texto, valores } = await capturar(chamada);

		for (const carga of [SEMPRE_VERDADEIRO, APAGA_TABELA, PAGINACAO]) {
			assert.ok(
				!texto.includes(carga),
				`a carga "${carga}" apareceu no comando de ${nome}`,
			);
		}

		// Todo valor passado chega pela lista, e todo marcador do comando
		// corresponde a um valor: $1..$n sem buracos e sem sobras.
		assert.equal(
			marcadores(texto).size,
			valores.length,
			`${nome}: marcadores e valores em numero diferente`,
		);
	});
}

/* ---------------------------------------------------------------------
 *  Primeira linha de defesa: a carga nem chega ao banco
 * ------------------------------------------------------------------- */

test("validarIdentificador recusa a carga antes de qualquer consulta", () => {
	for (const carga of ["1 OR 1=1", SEMPRE_VERDADEIRO, APAGA_TABELA, PAGINACAO]) {
		assert.throws(() => validarIdentificador(carga), /inteiro positivo/);
	}
});

test("validarEmail recusa a carga antes de qualquer consulta", () => {
	assert.throws(() => validarEmail(SEMPRE_VERDADEIRO), /e-mail valido/);
	assert.throws(() => validarEmail(APAGA_TABELA), /e-mail valido/);
});

/* ---------------------------------------------------------------------
 *  Guarda de regressao
 *
 *  Os testes acima verificam o comportamento de hoje. Este verifica a
 *  regra: nenhuma consulta de dados/ interpola valor no texto. As unicas
 *  interpolacoes permitidas sao as listas de colunas, que sao constantes
 *  do proprio arquivo e nunca vem de fora.
 * ------------------------------------------------------------------- */

test("nenhum repositorio interpola valores no SQL", () => {
	const AQUI = path.dirname(fileURLToPath(import.meta.url));
	const PERMITIDAS = new Set(["${CAMPOS}", "${CAMPOS_PUBLICOS}"]);

	for (const arquivo of fs.readdirSync(path.join(AQUI, "..", "src", "dados"))) {
		const fonte = fs.readFileSync(path.join(AQUI, "..", "src", "dados", arquivo), "utf8");

		for (const interpolacao of fonte.match(/\$\{[^}]*\}/g) ?? []) {
			assert.ok(
				PERMITIDAS.has(interpolacao),
				`${arquivo}: interpolacao "${interpolacao}" em consulta SQL`,
			);
		}
	}
});
