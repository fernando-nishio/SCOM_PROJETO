/**
 * Erros da aplicacao.
 *
 * Um ErroApp carrega tres coisas: o status HTTP, um codigo estavel que o
 * cliente pode testar, e uma mensagem escrita para ser lida por uma
 * pessoa. O middleware de erros formata; as camadas de baixo so lancam.
 *
 * A distincao que importa: ErroApp e falha PREVISTA (entrada invalida,
 * permissao insuficiente, fila cheia). Qualquer outra excecao e defeito,
 * vira 500 e tem os detalhes escondidos do cliente.
 */

export class ErroApp extends Error {
	/**
	 * @param {number} status  status HTTP
	 * @param {string} codigo  identificador estavel, MAIUSCULO_COM_UNDERLINE
	 * @param {string} mensagem  texto legivel, ja em portugues
	 * @param {object} [detalhes]  contexto extra; so aparece em desenvolvimento
	 */
	constructor(status, codigo, mensagem, detalhes) {
		super(mensagem);
		this.name = "ErroApp";
		this.status = status;
		this.codigo = codigo;
		this.detalhes = detalhes;

		// Marca para o middleware distinguir falha prevista de defeito.
		this.previsto = true;
	}
}

/* -------------------------------------------------------------------
 * Construtores dos casos recorrentes. Centralizar aqui mantem codigo e
 * mensagem consistentes entre as rotas - e e o que permite documentar
 * os codigos de erro na documentacao da API sem caca-los pelo projeto.
 * ----------------------------------------------------------------- */

export const erros = {
	entradaInvalida: (mensagem, detalhes) =>
		new ErroApp(400, "ENTRADA_INVALIDA", mensagem, detalhes),

	naoAutenticado: () =>
		new ErroApp(401, "NAO_AUTENTICADO", "E necessario entrar para realizar esta acao."),

	sessaoExpirada: () =>
		new ErroApp(401, "SESSAO_EXPIRADA", "Sua sessao expirou. Entre novamente."),

	semPermissao: () =>
		new ErroApp(403, "SEM_PERMISSAO", "Voce nao tem permissao para esta acao."),

	csrfInvalido: () =>
		new ErroApp(
			403,
			"CSRF_INVALIDO",
			"Token de seguranca ausente ou invalido. Recarregue a pagina e tente de novo.",
		),

	// Usado tambem quando o registro existe mas pertence a outra pessoa.
	// Responder 403 nesse caso confirmaria a existencia do item para quem
	// esta sondando; 404 nao confirma nada.
	naoEncontrado: (oque = "O recurso") =>
		new ErroApp(404, "NAO_ENCONTRADO", `${oque} nao foi encontrado.`),

	conflito: (mensagem) => new ErroApp(409, "CONFLITO", mensagem),

	arquivoGrandeDemais: (limiteMb) =>
		new ErroApp(
			413,
			"ARQUIVO_GRANDE_DEMAIS",
			`O arquivo excede o limite de ${limiteMb} MB.`,
		),

	formatoNaoSuportado: (mensagem) =>
		new ErroApp(415, "FORMATO_NAO_SUPORTADO", mensagem),

	muitasTentativas: () =>
		new ErroApp(
			429,
			"MUITAS_TENTATIVAS",
			"Muitas tentativas em pouco tempo. Aguarde alguns minutos.",
		),

	servidorOcupado: () =>
		new ErroApp(
			503,
			"SERVIDOR_OCUPADO",
			"O servidor esta processando muitas conversoes. Tente novamente em instantes.",
		),

	falhaConversao: (mensagem) => new ErroApp(422, "FALHA_CONVERSAO", mensagem),
};
