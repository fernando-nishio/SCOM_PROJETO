/**
 * Recepcao de arquivos enviados pelo cliente.
 *
 * Usa armazenamento em MEMORIA, nao em disco temporario. Tres razoes:
 *
 *   1. nada toca o disco antes de o conteudo ser validado;
 *   2. nao sobra arquivo temporario quando a requisicao falha no meio -
 *      o problema classico de quem esquece o finally;
 *   3. o limite de 20 MB torna o custo de memoria aceitavel.
 *
 * Para arquivos muito maiores a escolha se inverteria, e o streaming
 * para disco passaria a valer a pena.
 */

import multer from "multer";
import { config } from "../config/index.js";
import { erros } from "../util/erros.js";

/** Nome de arquivo acima disto e recusado antes de o conteudo chegar. */
export const NOME_MAX_CARACTERES = 300;

/**
 * Primeira peneira, pelo nome declarado. NAO e a validacao de verdade -
 * essa olha o conteudo, em util/formatos.js, depois que o arquivo chegou
 * inteiro. Serve para recusar cedo o obviamente errado e economizar
 * banda.
 *
 * A recusa precisa ser um ErroApp. O multer repassa o erro ao tratador
 * central, e um Error comum chegaria la como defeito: um nome longo
 * demais - erro de quem enviou - virava 500 ERRO_INTERNO e entrava no
 * log como falha do servidor. Exportada para os testes.
 */
export function filtrarArquivo(req, file, aceitar) {
	const nome = String(file?.originalname ?? "");

	// Nome absurdamente longo e sinal de tentativa de estouro de buffer
	// em algum ponto da cadeia.
	if (nome.length > NOME_MAX_CARACTERES) {
		return aceitar(
			erros.entradaInvalida(
				`O nome do arquivo deve ter no maximo ${NOME_MAX_CARACTERES} caracteres.`,
				{ campo: "arquivo" },
			),
		);
	}
	aceitar(null, true);
}

const upload = multer({
	storage: multer.memoryStorage(),

	limits: {
		fileSize: config.upload.tamanhoMaximoBytes,

		// Um unico arquivo por requisicao. Sem este teto, um cliente
		// poderia enviar mil arquivos de 19 MB numa requisicao so e
		// esgotar a memoria sem nunca esbarrar no fileSize.
		files: 1,

		// Teto para os campos de texto que acompanham o arquivo
		// (formatoOrigem, formatoDestino, origemConversao).
		fields: 10,
		fieldSize: 1024,
	},

	fileFilter: filtrarArquivo,
});

/** Recebe um arquivo no campo "arquivo". */
export const receberArquivo = upload.single("arquivo");
