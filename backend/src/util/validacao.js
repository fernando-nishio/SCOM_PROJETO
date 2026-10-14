/**
 * Validacao e normalizacao de entrada.
 *
 * Funcoes puras: recebem um valor, devolvem o valor normalizado ou
 * lancam ErroApp. Nao conhecem banco nem HTTP, e por isso sao testadas
 * sozinhas em testes/validacao.test.js.
 *
 * Toda entrada externa passa por aqui ANTES de chegar ao banco. As
 * constraints do schema.sql sao a segunda linha de defesa, nao a
 * primeira: elas protegem contra um caminho que esqueceu de validar, mas
 * produzem mensagem de erro de banco, que nao serve para o usuario.
 */

import { erros } from "./erros.js";

export const LIMITES = Object.freeze({
	NOME_MIN: 2,
	NOME_MAX: 120,
	EMAIL_MAX: 255,
	SENHA_MIN: 8,

	// O bcrypt ignora silenciosamente tudo que passa de 72 BYTES. Uma
	// senha de 100 caracteres seria truncada sem aviso, e o usuario
	// acreditaria ter uma senha mais forte do que tem. Rejeitar e mais
	// honesto do que truncar.
	SENHA_MAX_BYTES: 72,
});

/** Aceita apenas string; numero, objeto e nulo viram erro de entrada. */
function exigirTexto(valor, campo) {
	if (typeof valor !== "string") {
		throw erros.entradaInvalida(`O campo "${campo}" e obrigatorio.`, { campo });
	}
	return valor;
}

export function validarNome(valor) {
	const nome = exigirTexto(valor, "nome").trim();

	if (nome.length < LIMITES.NOME_MIN) {
		throw erros.entradaInvalida(
			`O nome deve ter pelo menos ${LIMITES.NOME_MIN} caracteres.`,
			{ campo: "nome" },
		);
	}
	if (nome.length > LIMITES.NOME_MAX) {
		throw erros.entradaInvalida(
			`O nome deve ter no maximo ${LIMITES.NOME_MAX} caracteres.`,
			{ campo: "nome" },
		);
	}
	return nome;
}

/**
 * Normaliza para minusculas e sem espacos nas bordas. Sem isso,
 * "Fulano@X.com" e "fulano@x.com" criariam duas contas distintas, porque
 * o UNIQUE do PostgreSQL diferencia maiusculas.
 */
export function validarEmail(valor) {
	const email = exigirTexto(valor, "email").trim().toLowerCase();

	if (email.length > LIMITES.EMAIL_MAX) {
		throw erros.entradaInvalida("O e-mail e longo demais.", { campo: "email" });
	}

	// Verificacao deliberadamente simples: um unico @, com texto antes,
	// e um ponto depois. A especificacao de e-mail valido e muito mais
	// permissiva do que a intuicao sugere, e expressoes "completas" sao
	// famosas por rejeitar enderecos legitimos.
	const formatoAceitavel = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	if (!formatoAceitavel) {
		throw erros.entradaInvalida("Informe um e-mail valido.", { campo: "email" });
	}

	return email;
}

/**
 * A senha NAO e aparada nem normalizada: espaco no inicio ou no fim faz
 * parte da senha que o usuario escolheu.
 */
export function validarSenha(valor) {
	const senha = exigirTexto(valor, "senha");

	if (senha.length < LIMITES.SENHA_MIN) {
		throw erros.entradaInvalida(
			`A senha deve ter pelo menos ${LIMITES.SENHA_MIN} caracteres.`,
			{ campo: "senha" },
		);
	}

	// Medido em bytes, nao em caracteres: um emoji ocupa 4 bytes, um "ç"
	// ocupa 2. Contar caracteres deixaria passar senhas que o bcrypt
	// truncaria.
	if (Buffer.byteLength(senha, "utf8") > LIMITES.SENHA_MAX_BYTES) {
		throw erros.entradaInvalida(
			`A senha deve ter no maximo ${LIMITES.SENHA_MAX_BYTES} bytes.`,
			{ campo: "senha" },
		);
	}

	return senha;
}

/**
 * Inteiro positivo vindo de parametro de rota ou de query string.
 * Rejeita "1.5", "abc", "-3" e notacao cientifica.
 */
export function validarIdentificador(valor, campo = "id") {
	const texto = String(valor ?? "").trim();

	if (!/^[1-9]\d{0,17}$/.test(texto)) {
		throw erros.entradaInvalida(`O campo "${campo}" deve ser um numero inteiro positivo.`, {
			campo,
		});
	}
	return Number(texto);
}
