/**
 * Limitacao de taxa (rate limiting).
 *
 * Resolve um problema diferente do da fila de conversao: a fila protege
 * contra carga legitima alta; o rate limit protege contra UM cliente
 * abusando. Os dois sao necessarios e nao se substituem.
 *
 * No login a protecao e essencial - sem ela, tentar milhares de senhas
 * por minuto nao custa nada ao atacante.
 */

import rateLimit from "express-rate-limit";
import { erros } from "../util/erros.js";

/** Encaminha a recusa ao tratador central, para manter o formato de erro
 *  igual ao do resto da API. */
function recusar(req, res, proximo) {
	proximo(erros.muitasTentativas());
}

/**
 * Login e cadastro: 10 tentativas por IP a cada 15 minutos.
 *
 * skipSuccessfulRequests faz com que apenas as tentativas FALHAS contem.
 * Quem acerta a senha nunca esbarra no limite, mesmo entrando varias
 * vezes; quem erra em sequencia esbarra rapido. E a diferenca entre
 * atrapalhar o usuario distraido e barrar a forca bruta.
 */
export const limiteAutenticacao = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	skipSuccessfulRequests: true,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	handler: recusar,
});

/**
 * Conversao no servidor: 30 por IP a cada 10 minutos.
 *
 * Mais generoso porque converter e o proposito do sistema. O teto existe
 * para impedir que um unico cliente ocupe a fila inteira.
 */
export const limiteConversao = rateLimit({
	windowMs: 10 * 60 * 1000,
	limit: 30,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	handler: recusar,
});

/**
 * Teto geral da API: 300 requisicoes por IP a cada 5 minutos.
 *
 * Nao atrapalha uso normal; corta varredura automatizada.
 */
export const limiteGeral = rateLimit({
	windowMs: 5 * 60 * 1000,
	limit: 300,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	handler: recusar,
});
