/**
 * Protecao contra CSRF (Cross-Site Request Forgery).
 *
 * O ataque: estando a vitima logada no Freevertio, um site qualquer
 * monta um formulario que aponta para a nossa API. O navegador anexa o
 * cookie de sessao sozinho - ele nao sabe que a requisicao foi
 * originada por outro site - e a acao executa em nome da vitima.
 *
 * Este projeto usa DUAS defesas independentes:
 *
 *   1. cookie SameSite=Strict (em servidor.js). O navegador se recusa a
 *      enviar o cookie em requisicao vinda de outra origem. Defesa
 *      moderna, forte, e que nao exige nada do cliente - mas depende
 *      inteiramente do navegador respeita-la.
 *
 *   2. token sincronizador, implementado aqui. O servidor guarda um
 *      segredo na sessao e o cliente precisa devolve-lo num cabecalho.
 *      Um site atacante consegue FAZER a requisicao, mas nao consegue
 *      LER o token (a politica de mesma origem impede), entao nao sabe
 *      o que enviar.
 *
 * Escrito a mao em vez de usar uma biblioteca: o csurf esta
 * descontinuado ha anos, e a logica cabe em trinta linhas que da para
 * explicar numa defesa.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { erros } from "../util/erros.js";

const CABECALHO = "x-csrf-token";

/** Metodos que apenas leem nao mudam estado e nao precisam de token. */
const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Gera o token da sessao, ou devolve o que ja existe. */
export function obterToken(req) {
	if (!req.session) {
		throw new Error("obterToken exige sessao configurada.");
	}
	if (!req.session.csrfToken) {
		req.session.csrfToken = randomBytes(32).toString("hex");
	}
	return req.session.csrfToken;
}

/**
 * Comparacao em tempo constante.
 *
 * Um === comum sai no primeiro byte diferente, e essa diferenca de tempo
 * e mensuravel: daria para descobrir o token byte a byte. O
 * timingSafeEqual sempre percorre o buffer inteiro.
 *
 * Os comprimentos sao comparados antes porque timingSafeEqual lanca
 * quando diferem - e o comprimento nao e segredo.
 */
function iguais(a, b) {
	const bufA = Buffer.from(String(a ?? ""), "utf8");
	const bufB = Buffer.from(String(b ?? ""), "utf8");

	if (bufA.length !== bufB.length || bufA.length === 0) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * Exige o token em toda requisicao que muda estado.
 *
 * Registrar DEPOIS da sessao e ANTES das rotas de escrita.
 */
export function verificarCsrf(req, res, proximo) {
	if (METODOS_SEGUROS.has(req.method)) {
		return proximo();
	}

	// Sem sessao nao ha o que falsificar: o cookie que o atacante
	// exploraria nao existe. O login em si cai neste caso, e e por isso
	// que ele nao precisa de token.
	if (!req.session?.usuarioId) {
		return proximo();
	}

	const enviado = req.get(CABECALHO) ?? req.body?._csrf;

	if (!iguais(enviado, req.session.csrfToken)) {
		return proximo(erros.csrfInvalido());
	}

	proximo();
}

/**
 * GET /api/csrf - entrega o token ao cliente.
 *
 * Pode ser publica: o token so vale junto com o cookie de sessao de quem
 * o pediu, e um site atacante nao consegue ler esta resposta por causa
 * da politica de mesma origem.
 */
export function rotaToken(req, res) {
	res.json({ csrfToken: obterToken(req) });
}

/** Exportado para os testes. */
export const _interno = { iguais, CABECALHO, METODOS_SEGUROS };
