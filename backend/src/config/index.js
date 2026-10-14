/**
 * Configuracao da aplicacao.
 *
 * Este e o UNICO modulo do projeto que le process.env. Todo o resto
 * importa daqui. A regra tem duas consequencias praticas: trocar a
 * origem da configuracao mexe em um arquivo so, e um teste automatizado
 * pode substituir a configuracao sem mexer no ambiente.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_BACKEND = path.resolve(AQUI, "..", "..");

dotenv.config({ path: path.join(RAIZ_BACKEND, ".env") });

/**
 * Le uma variavel obrigatoria. Falha na subida, e nao no meio de uma
 * requisicao, quando a configuracao esta incompleta.
 */
function obrigatoria(nome) {
	const valor = process.env[nome];
	if (valor === undefined || valor.trim() === "") {
		throw new Error(
			`Variavel de ambiente ${nome} nao definida. ` +
				`Copie backend/.env.example para backend/.env e preencha os valores.`,
		);
	}
	return valor;
}

function numero(nome, padrao) {
	const bruto = process.env[nome];
	if (bruto === undefined || bruto.trim() === "") return padrao;

	const valor = Number(bruto);
	if (!Number.isFinite(valor)) {
		throw new Error(`Variavel ${nome} deve ser um numero, recebido "${bruto}".`);
	}
	return valor;
}

const segredoSessao = obrigatoria("SESSAO_SEGREDO");

if (segredoSessao.length < 32) {
	throw new Error(
		"SESSAO_SEGREDO precisa ter pelo menos 32 caracteres. " +
			'Gere um com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
	);
}

const ambiente = process.env.NODE_ENV ?? "production";
const horasSessao = numero("SESSAO_HORAS", 12);

export const config = Object.freeze({
	ambiente,
	desenvolvimento: ambiente === "development",
	porta: numero("PORTA", 3000),

	banco: Object.freeze({
		host: process.env.PGHOST ?? "localhost",
		port: numero("PGPORT", 5432),
		database: obrigatoria("PGDATABASE"),
		user: obrigatoria("PGUSER"),
		password: obrigatoria("PGPASSWORD"),
	}),

	sessao: Object.freeze({
		segredo: segredoSessao,
		nomeCookie: "freevertio.sid",
		duracaoMs: horasSessao * 60 * 60 * 1000,
		tabela: "sessao",
	}),

	// Resolvido para caminho absoluto: o servidor nao pode depender do
	// diretorio de onde foi iniciado.
	caminhoArmazenamento: path.resolve(
		RAIZ_BACKEND,
		process.env.CAMINHO_ARMAZENAMENTO ?? "../armazenamento",
	),

	caminhoFrontend: path.resolve(RAIZ_BACKEND, "..", "frontend"),

	upload: Object.freeze({
		tamanhoMaximoBytes: numero("UPLOAD_MAX_MB", 20) * 1024 * 1024,
	}),

	conversao: Object.freeze({
		concorrencia: numero("CONVERSAO_CONCORRENCIA", 4),
		filaMaxima: numero("CONVERSAO_FILA_MAX", 50),
		timeoutMs: numero("CONVERSAO_TIMEOUT_S", 30) * 1000,
	}),
});
