/**
 * Estado da sessao na barra de navegacao.
 *
 * Importado por todas as paginas. Faz duas coisas: pergunta ao servidor
 * quem esta logado e ajusta o menu de acordo.
 *
 * Por que o servidor decide isso, e nao o navegador: no Trabalho I o
 * "estar logado" era uma chave no localStorage, que qualquer um
 * escrevia pelo console. Agora a unica fonte e GET /api/sessao, e o
 * cookie que a sustenta nao e legivel por JavaScript.
 *
 * O que esta funcao ajusta e apenas APARENCIA. Esconder o link da
 * biblioteca nao protege nada - quem protege e o exigirLogin no
 * servidor. Um menu que mente sobre o estado da sessao e problema de
 * usabilidade; um servidor que confia no menu seria problema de
 * seguranca.
 */

import { sessao } from "./api.js";

/**
 * Atualiza a barra de navegacao e devolve o usuario logado, ou null.
 *
 * Espera encontrar no HTML, dentro da lista do menu:
 *
 *   <li data-sessao="anonimo">  ... mostrado so para visitante
 *   <li data-sessao="logado">   ... mostrado so para quem entrou
 *   <li data-sessao="admin">    ... mostrado so para administrador
 *
 * Os itens sem data-sessao aparecem sempre.
 */
export async function montarBarraDeSessao() {
	let usuario = null;

	try {
		const estado = await sessao.atual();
		usuario = estado.autenticado ? estado.usuario : null;
	} catch {
		// Servidor fora do ar: trata como visitante. A conversao local
		// continua funcionando sem backend, e a pagina nao pode quebrar
		// por causa do menu.
		usuario = null;
	}

	for (const item of document.querySelectorAll("[data-sessao]")) {
		const exigido = item.dataset.sessao;

		const mostrar =
			(exigido === "anonimo" && usuario === null) ||
			(exigido === "logado" && usuario !== null) ||
			(exigido === "admin" && usuario?.perfil === "admin");

		item.hidden = !mostrar;
	}

	const nome = document.querySelector("[data-usuario-nome]");
	if (nome) nome.textContent = usuario ? usuario.nome : "";

	ligarBotaoSair();
	return usuario;
}

function ligarBotaoSair() {
	const botao = document.querySelector("[data-acao='sair']");
	if (!botao || botao.dataset.ligado === "1") return;

	botao.dataset.ligado = "1";
	botao.addEventListener("click", async (evento) => {
		evento.preventDefault();
		botao.disabled = true;

		try {
			await sessao.sair();
		} finally {
			// Recarrega mesmo se o logout falhar: deixar a pagina
			// mostrando um estado que o servidor ja nao reconhece e pior
			// do que recarregar a toa.
			window.location.href = "index.html";
		}
	});
}

/**
 * Exige sessao para ver a pagina. Usada pela biblioteca e pela area
 * administrativa.
 *
 * Isto e conveniencia, nao protecao: o dado em si so chega pela API, que
 * verifica a sessao de verdade. Redirecionar evita a tela vazia com uma
 * mensagem de erro, que seria a alternativa.
 */
export async function exigirSessao({ perfil = null } = {}) {
	const usuario = await montarBarraDeSessao();

	if (!usuario) {
		const destino = encodeURIComponent(
			window.location.pathname.split("/").pop() + window.location.search,
		);
		window.location.href = `login.html?voltar=${destino}`;
		return null;
	}

	if (perfil && usuario.perfil !== perfil) {
		window.location.href = "index.html";
		return null;
	}

	return usuario;
}
