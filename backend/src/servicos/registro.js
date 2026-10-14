/**
 * Registro de eventos: console + tabela log_evento.
 *
 * Esta e a funcao que o resto da aplicacao chama. Ela combina o
 * formatador (util/logger.js) com o repositorio (dados/log-repo.js).
 *
 * Duas decisoes deliberadas:
 *
 * 1. A gravacao no banco NAO e esperada (sem await no chamador). Logar e
 *    efeito colateral; a requisicao do usuario nao deve ficar mais lenta
 *    por causa disso.
 *
 * 2. Se a gravacao falhar, o erro e engolido depois de ir para o
 *    console. Um log que derruba a operacao que estava registrando e
 *    pior que nenhum log - e o banco fora do ar e justamente a hora em
 *    que mais se precisa do console funcionando.
 */

import { escrever } from "../util/logger.js";
import * as logRepo from "../dados/log-repo.js";

/** Nomes dos eventos. Constantes para nao haver 'login_sucesso' escrito
 *  de tres jeitos diferentes pelo projeto - o que quebraria qualquer
 *  agregacao por evento. */
export const EVENTOS = Object.freeze({
	LOGIN_SUCESSO: "login_sucesso",
	LOGIN_FALHA: "login_falha",
	LOGOUT: "logout",
	CONTA_CRIADA: "conta_criada",
	CONVERSAO_CRIADA: "conversao_criada",
	ITEM_GUARDADO: "item_guardado",
	ITEM_APAGADO: "item_apagado",
	ACESSO_NEGADO: "acesso_negado",
	ERRO_INTERNO: "erro_interno",
	SERVIDOR_INICIADO: "servidor_iniciado",
});

/**
 * @param {'info'|'aviso'|'erro'} nivel
 * @param {string} evento  um valor de EVENTOS
 * @param {{usuarioId?: number|null, ip?: string|null, detalhe?: string|null}} [contexto]
 */
export function registrar(nivel, evento, contexto = {}) {
	escrever(nivel, evento, contexto);

	logRepo
		.inserir({
			nivel,
			evento,
			usuarioId: contexto.usuarioId ?? null,
			ip: contexto.ip ?? null,
			detalhe: contexto.detalhe ?? null,
		})
		.catch((erro) => {
			escrever("erro", "falha_ao_gravar_log", { detalhe: erro.message });
		});
}

/**
 * Extrai o IP de origem de uma requisicao.
 *
 * Em desenvolvimento o Express entrega '::ffff:127.0.0.1' (IPv4 mapeado
 * em IPv6), que a coluna INET aceita mas e ruim de ler; o prefixo e
 * removido. Atras de proxy reverso, e preciso configurar 'trust proxy'
 * para que req.ip reflita o cliente real e nao o proxy.
 */
export function ipDaRequisicao(req) {
	const bruto = req.ip ?? null;
	if (!bruto) return null;
	return bruto.startsWith("::ffff:") ? bruto.slice(7) : bruto;
}
