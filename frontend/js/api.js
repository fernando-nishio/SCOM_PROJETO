/**
 * Camada de acesso a API.
 *
 * TODO fetch do site passa por aqui. Nenhuma outra pagina chama fetch
 * diretamente. Com isso, tres coisas ficam definidas num lugar so:
 *
 *   - o token CSRF, enviado no cabecalho de toda requisicao de escrita;
 *   - o envio do cookie de sessao;
 *   - a traducao de uma resposta de erro em algo que o JavaScript possa
 *     tratar.
 *
 * Sem este modulo, cada pagina repetiria as tres coisas - e bastaria uma
 * esquecer o token para a acao dela parar de funcionar sem motivo
 * aparente.
 */

const BASE = "/api";

/* ---------------------------------------------------------------------
 *  Erro
 * ------------------------------------------------------------------- */

/**
 * Erro vindo da API, ja com o codigo estavel e a mensagem pronta para
 * ser mostrada ao usuario.
 *
 * O `codigo` e o que o codigo da pagina deve testar - nunca o texto da
 * mensagem, que pode mudar.
 */
export class ErroApi extends Error {
	constructor({ codigo, mensagem, status }) {
		super(mensagem);
		this.name = "ErroApi";
		this.codigo = codigo;
		this.status = status;
	}

	get ehSessaoExpirada() {
		return this.codigo === "NAO_AUTENTICADO" || this.codigo === "SESSAO_EXPIRADA";
	}
}

/** Falha de rede: o servidor nao respondeu. Diferente de respondeu com erro. */
export class ErroDeRede extends Error {
	constructor() {
		super("Nao foi possivel falar com o servidor. Verifique sua conexao.");
		this.name = "ErroDeRede";
		this.codigo = "SEM_CONEXAO";
	}
}

/* ---------------------------------------------------------------------
 *  Token CSRF
 * ------------------------------------------------------------------- */

let tokenCsrf = null;

/**
 * Busca o token uma vez e guarda em memoria.
 *
 * Em memoria, e nao em localStorage: o token acompanha a sessao, e
 * guarda-lo em disco criaria a chance de usar um token velho depois de
 * um logout. Perder o token ao recarregar a pagina nao custa nada - ele
 * e buscado de novo.
 */
async function obterToken() {
	if (tokenCsrf) return tokenCsrf;

	const resposta = await fetch(`${BASE}/csrf`, { credentials: "same-origin" });
	const dados = await resposta.json();

	tokenCsrf = dados.csrfToken;
	return tokenCsrf;
}

/** Chamado depois do logout: o token da sessao encerrada nao vale mais. */
export function esquecerToken() {
	tokenCsrf = null;
}

/* ---------------------------------------------------------------------
 *  Requisicao
 * ------------------------------------------------------------------- */

const METODOS_DE_ESCRITA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function requisitar(caminho, { metodo = "GET", corpo, sinal } = {}) {
	const opcoes = {
		method: metodo,
		// Manda o cookie de sessao. Sem isto, toda requisicao chegaria
		// anonima ao servidor.
		credentials: "same-origin",
		headers: {},
		signal: sinal,
	};

	if (METODOS_DE_ESCRITA.has(metodo)) {
		opcoes.headers["X-CSRF-Token"] = await obterToken();
	}

	if (corpo instanceof FormData) {
		// NAO definir Content-Type aqui: o navegador precisa gerar o
		// cabecalho com a fronteira (boundary) do multipart. Defini-lo a
		// mao quebra o envio de arquivo de um jeito dificil de depurar.
		opcoes.body = corpo;
	} else if (corpo !== undefined) {
		opcoes.headers["Content-Type"] = "application/json";
		opcoes.body = JSON.stringify(corpo);
	}

	let resposta;
	try {
		resposta = await fetch(`${BASE}${caminho}`, opcoes);
	} catch (erro) {
		// AbortError vem de um cancelamento pedido pelo usuario: nao e
		// falha de rede e deve subir como veio.
		if (erro.name === "AbortError") throw erro;
		throw new ErroDeRede();
	}

	if (resposta.status === 204) return null;

	if (!resposta.ok) {
		const dados = await resposta.json().catch(() => ({}));
		const erro = dados.erro ?? {};

		// Token recusado quase sempre significa sessao trocada. Esquecer
		// o token faz a proxima tentativa buscar um novo.
		if (erro.codigo === "CSRF_INVALIDO") esquecerToken();

		throw new ErroApi({
			codigo: erro.codigo ?? "ERRO_DESCONHECIDO",
			mensagem: erro.mensagem ?? "Ocorreu um erro inesperado.",
			status: resposta.status,
		});
	}

	const tipo = resposta.headers.get("Content-Type") ?? "";
	return tipo.includes("application/json") ? resposta.json() : resposta;
}

/* ---------------------------------------------------------------------
 *  Sessao
 * ------------------------------------------------------------------- */

export const sessao = {
	/** @returns {Promise<{autenticado: boolean, usuario: object|null}>} */
	atual: () => requisitar("/sessao"),

	entrar: (email, senha) => requisitar("/sessao", { metodo: "POST", corpo: { email, senha } }),

	async sair() {
		await requisitar("/sessao", { metodo: "DELETE" });
		esquecerToken();
	},

	cadastrar: (nome, email, senha) =>
		requisitar("/contas", { metodo: "POST", corpo: { nome, email, senha } }),
};

/* ---------------------------------------------------------------------
 *  Conversao
 * ------------------------------------------------------------------- */

export const conversoes = {
	/** O que o servidor consegue converter, e o estado da fila. */
	formatos: () => requisitar("/conversoes/formatos"),

	/**
	 * Converte no servidor.
	 *
	 * Devolve o Blob do arquivo convertido e, quando o usuario pediu para
	 * guardar, o id do item criado - que vem no cabecalho X-Item-Id.
	 *
	 * O parametro `sinal` aceita um AbortSignal, para que a pagina possa
	 * oferecer o cancelamento de uma conversao demorada.
	 */
	async converter({ arquivo, formatoDestino, guardar = false, sinal }) {
		const dados = new FormData();
		dados.append("arquivo", arquivo);
		dados.append("formatoDestino", formatoDestino);
		if (guardar) dados.append("guardar", "1");

		const resposta = await requisitar("/conversoes", {
			metodo: "POST",
			corpo: dados,
			sinal,
		});

		return {
			blob: await resposta.blob(),
			itemId: resposta.headers.get("X-Item-Id"),
		};
	},
};

/* ---------------------------------------------------------------------
 *  Biblioteca
 * ------------------------------------------------------------------- */

export const biblioteca = {
	listar: ({ pagina = 1, porPagina = 20 } = {}) =>
		requisitar(`/biblioteca?pagina=${pagina}&porPagina=${porPagina}`),

	/** Guarda um arquivo convertido no proprio navegador. */
	guardar({ blob, nome, formatoOrigem, formatoDestino }) {
		const dados = new FormData();
		dados.append("arquivo", blob, nome);
		dados.append("formatoOrigem", formatoOrigem);
		dados.append("formatoDestino", formatoDestino);
		dados.append("origemConversao", "local");

		return requisitar("/biblioteca", { metodo: "POST", corpo: dados });
	},

	renomear: (id, nome) =>
		requisitar(`/biblioteca/${id}`, { metodo: "PATCH", corpo: { nome } }),

	apagar: (id) => requisitar(`/biblioteca/${id}`, { metodo: "DELETE" }),

	/** Endereco de download. Usado direto no href de um link. */
	enderecoDoArquivo: (id) => `${BASE}/biblioteca/${id}/arquivo`,
};

/* ---------------------------------------------------------------------
 *  Administracao
 * ------------------------------------------------------------------- */

export const administracao = {
	usuarios: ({ pagina = 1 } = {}) => requisitar(`/admin/usuarios?pagina=${pagina}`),

	definirAtivo: (id, ativo) =>
		requisitar(`/admin/usuarios/${id}`, { metodo: "PATCH", corpo: { ativo } }),

	conversoes: ({ pagina = 1 } = {}) => requisitar(`/admin/conversoes?pagina=${pagina}`),

	apagarConversao: (id) => requisitar(`/admin/conversoes/${id}`, { metodo: "DELETE" }),

	logs: ({ nivel = null, pagina = 1 } = {}) =>
		requisitar(`/admin/logs?pagina=${pagina}${nivel ? `&nivel=${nivel}` : ""}`),

	estatisticas: ({ desdeHoras = 24 } = {}) =>
		requisitar(`/admin/estatisticas?desdeHoras=${desdeHoras}`),
};

/* ---------------------------------------------------------------------
 *  Utilitarios de pagina
 * ------------------------------------------------------------------- */

/**
 * Dispara o download de um Blob.
 *
 * O revokeObjectURL e obrigatorio: sem ele, o Blob fica preso na memoria
 * ate a aba fechar. E a mesma regra que o conversor local ja seguia.
 */
export function baixarBlob(blob, nome) {
	const endereco = URL.createObjectURL(blob);

	const link = document.createElement("a");
	link.href = endereco;
	link.download = nome;
	document.body.appendChild(link);
	link.click();
	link.remove();

	// Um instante para o navegador iniciar o download antes de liberar.
	setTimeout(() => URL.revokeObjectURL(endereco), 1000);
}

/** Tamanho legivel: 1536 -> "1,5 KB". */
export function formatarTamanho(bytes) {
	const unidades = ["B", "KB", "MB", "GB"];
	let valor = Number(bytes) || 0;
	let i = 0;

	while (valor >= 1024 && i < unidades.length - 1) {
		valor /= 1024;
		i++;
	}

	const texto = i === 0 ? String(valor) : valor.toFixed(1).replace(".", ",");
	return `${texto} ${unidades[i]}`;
}

/** Data legivel no formato brasileiro. */
export function formatarData(iso) {
	return new Date(iso).toLocaleString("pt-BR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
