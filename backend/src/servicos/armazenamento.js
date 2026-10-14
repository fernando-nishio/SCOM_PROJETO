/**
 * Gravacao, leitura e remocao dos arquivos da biblioteca em disco.
 *
 * Toda operacao de arquivo do projeto passa por aqui. Concentrar isso
 * num modulo so e o que permite garantir, lendo um arquivo, que nenhum
 * caminho e montado com texto vindo do cliente.
 *
 * O caminho de um arquivo e SEMPRE:
 *     <config.caminhoArmazenamento>/<uuid>.<extensao>
 *
 * O UUID e gerado pelo servidor e validado antes de virar caminho; a
 * extensao vem de uma lista fechada. Nada do que o usuario digita entra
 * nessa construcao.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { config } from "../config/index.js";
import { FORMATOS } from "../util/formatos.js";
import { escrever } from "../util/logger.js";

/** Formato canonico de um UUID v4, como o PostgreSQL devolve. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Monta o caminho absoluto de um arquivo guardado.
 *
 * As duas validacoes nao sao paranoia decorativa: elas sao o unico ponto
 * do sistema onde um caminho e construido, e qualquer travessia de
 * diretorio teria de passar por aqui.
 */
function caminhoDe(nomeArmazenado, formato) {
	if (!UUID.test(String(nomeArmazenado))) {
		throw new Error(`Identificador de arquivo invalido: ${nomeArmazenado}`);
	}
	if (!Object.hasOwn(FORMATOS, formato)) {
		throw new Error(`Formato invalido: ${formato}`);
	}

	const caminho = path.join(config.caminhoArmazenamento, `${nomeArmazenado}.${formato}`);

	// Cinto e suspensorio: mesmo com as duas verificacoes acima, confere
	// que o resultado continua dentro do diretorio de armazenamento.
	const dentro =
		caminho.startsWith(config.caminhoArmazenamento + path.sep) &&
		!caminho.includes("..");

	if (!dentro) {
		throw new Error("Caminho resolvido fora do diretorio de armazenamento.");
	}

	return caminho;
}

export async function garantirDiretorio() {
	await fs.mkdir(config.caminhoArmazenamento, { recursive: true });
}

/**
 * Grava o conteudo e devolve o identificador gerado.
 *
 * O modo 0o600 restringe a leitura ao dono do processo: arquivos de
 * usuarios nao precisam ser legiveis por qualquer conta da maquina.
 */
export async function gravar(buffer, formato) {
	const nomeArmazenado = randomUUID();
	const caminho = caminhoDe(nomeArmazenado, formato);

	await garantirDiretorio();
	await fs.writeFile(caminho, buffer, { mode: 0o600 });

	return nomeArmazenado;
}

export async function ler(nomeArmazenado, formato) {
	return fs.readFile(caminhoDe(nomeArmazenado, formato));
}

export async function existe(nomeArmazenado, formato) {
	try {
		await fs.access(caminhoDe(nomeArmazenado, formato));
		return true;
	} catch {
		return false;
	}
}

/**
 * Remove o arquivo. Nao lanca se ele ja nao existir.
 *
 * O chamador apaga a linha do banco PRIMEIRO e so depois chama esta
 * funcao. A ordem e deliberada: se a remocao do arquivo falhar, sobra um
 * arquivo orfao - invisivel para o usuario e recuperavel por uma
 * limpeza posterior. Na ordem inversa, uma falha deixaria uma linha
 * apontando para um arquivo que nao existe mais, e isso o usuario ve.
 */
export async function remover(nomeArmazenado, formato) {
	try {
		await fs.unlink(caminhoDe(nomeArmazenado, formato));
		return true;
	} catch (erro) {
		if (erro.code === "ENOENT") return false;

		escrever("erro", "falha_ao_remover_arquivo", {
			detalhe: `${nomeArmazenado}.${formato} :: ${erro.message}`,
		});
		return false;
	}
}

/** Espaco total ocupado em disco, para a area administrativa. */
export async function espacoOcupadoBytes() {
	try {
		const arquivos = await fs.readdir(config.caminhoArmazenamento);
		let total = 0;

		for (const arquivo of arquivos) {
			const info = await fs.stat(path.join(config.caminhoArmazenamento, arquivo));
			if (info.isFile()) total += info.size;
		}
		return total;
	} catch {
		return 0;
	}
}
