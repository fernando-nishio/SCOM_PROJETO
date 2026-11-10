/**
 * Tela da biblioteca.
 *
 * Lista, baixa, renomeia e apaga os arquivos guardados.
 *
 * Regra que vale para o arquivo inteiro: todo texto vindo do servidor e
 * escrito com textContent, nunca com innerHTML. Os nomes de arquivo sao
 * dados de usuario, e um arquivo chamado
 * `<img src=x onerror=alert(1)>.png` executaria script se a pagina o
 * inserisse como HTML. Com textContent ele aparece como um nome feio e
 * nada mais.
 */

import {
	biblioteca,
	ErroApi,
	formatarTamanho,
	formatarData,
} from "./api.js";
import { exigirSessao } from "./sessao-ui.js";

const POR_PAGINA = 10;

const elementos = {
	lista: document.getElementById("lista"),
	vazio: document.getElementById("estado_vazio"),
	carregando: document.getElementById("carregando"),
	mensagem: document.getElementById("mensagem"),
	erro: document.getElementById("mensagem_erro"),
	paginacao: document.getElementById("paginacao"),
	anterior: document.getElementById("pagina_anterior"),
	seguinte: document.getElementById("pagina_seguinte"),
	indicador: document.getElementById("indicador_pagina"),

	dialogoApagar: document.getElementById("dialogo_apagar"),
	nomeParaApagar: document.getElementById("nome_para_apagar"),
	confirmarApagar: document.getElementById("confirmar_apagar"),
	cancelarApagar: document.getElementById("cancelar_apagar"),

	dialogoRenomear: document.getElementById("dialogo_renomear"),
	novoNome: document.getElementById("novo_nome"),
	confirmarRenomear: document.getElementById("confirmar_renomear"),
	cancelarRenomear: document.getElementById("cancelar_renomear"),
};

let paginaAtual = 1;
let totalPaginas = 1;
let itemSelecionado = null;

/* ---------------------------------------------------------------------
 *  Mensagens
 * ------------------------------------------------------------------- */

function avisar(texto) {
	elementos.erro.hidden = true;
	elementos.mensagem.textContent = texto;
	elementos.mensagem.hidden = false;
	setTimeout(() => (elementos.mensagem.hidden = true), 4000);
}

function reclamar(texto) {
	elementos.mensagem.hidden = true;
	elementos.erro.textContent = texto;
	elementos.erro.hidden = false;
}

/**
 * Trata o erro de um jeito so em toda a pagina.
 *
 * Sessao expirada tem destino proprio: perder a sessao no meio da tarefa
 * e frustrante, e mandar de volta ao login com ?voltar faz o usuario
 * retornar ao que estava fazendo em vez de cair na pagina inicial.
 */
function tratar(erro) {
	if (erro instanceof ErroApi && erro.ehSessaoExpirada) {
		window.location.href = "login.html?voltar=biblioteca.html";
		return;
	}
	reclamar(erro.mensagem ?? "Ocorreu um erro inesperado.");
}

/* ---------------------------------------------------------------------
 *  Montagem da lista
 * ------------------------------------------------------------------- */

function criarSelo(origem) {
	const selo = document.createElement("span");
	selo.className = `selo selo_${origem}`;
	selo.textContent = origem === "local" ? "convertido no navegador" : "convertido no servidor";

	// O texto do selo ja e autoexplicativo; o title acrescenta o porque.
	selo.title =
		origem === "local"
			? "A conversão aconteceu na sua máquina. O arquivo só foi enviado para ser guardado."
			: "O arquivo foi enviado ao servidor para ser convertido.";

	return selo;
}

function criarItem(item) {
	const li = document.createElement("li");
	li.className = "item_biblioteca";

	const dados = document.createElement("div");
	dados.className = "item_dados";

	const nome = document.createElement("p");
	nome.className = "item_nome";
	nome.textContent = item.nome;      // nunca innerHTML
	nome.title = item.nome;            // o nome inteiro, quando cortado pelo ellipsis

	const detalhes = document.createElement("div");
	detalhes.className = "item_detalhes";

	const conversao = document.createElement("span");
	conversao.textContent =
		`${item.formatoOrigem.toUpperCase()} → ${item.formatoDestino.toUpperCase()}`;

	const tamanho = document.createElement("span");
	tamanho.textContent = formatarTamanho(item.tamanhoBytes);

	const data = document.createElement("time");
	data.dateTime = item.criadoEm;
	data.textContent = formatarData(item.criadoEm);

	detalhes.append(conversao, tamanho, data, criarSelo(item.origemConversao));
	dados.append(nome, detalhes);

	const acoes = document.createElement("div");
	acoes.className = "item_acoes";

	// Baixar e um link de verdade, nao um botao com JavaScript: funciona
	// com "abrir em nova aba", com o teclado e sem script.
	const baixar = document.createElement("a");
	baixar.className = "botao_pequeno";
	baixar.href = biblioteca.enderecoDoArquivo(item.id);
	baixar.download = item.nome;
	baixar.textContent = "Baixar";
	baixar.setAttribute("aria-label", `Baixar ${item.nome}`);

	const renomear = document.createElement("button");
	renomear.type = "button";
	renomear.className = "botao_pequeno";
	renomear.textContent = "Renomear";
	renomear.setAttribute("aria-label", `Renomear ${item.nome}`);
	renomear.addEventListener("click", () => abrirRenomear(item));

	const apagar = document.createElement("button");
	apagar.type = "button";
	apagar.className = "botao_pequeno botao_perigo";
	apagar.textContent = "Apagar";
	apagar.setAttribute("aria-label", `Apagar ${item.nome}`);
	apagar.addEventListener("click", () => abrirApagar(item));

	acoes.append(baixar, renomear, apagar);
	li.append(dados, acoes);
	return li;
}

async function carregar(pagina = 1) {
	elementos.carregando.hidden = false;
	elementos.erro.hidden = true;

	try {
		const { itens, paginacao } = await biblioteca.listar({
			pagina,
			porPagina: POR_PAGINA,
		});

		paginaAtual = paginacao.pagina;
		totalPaginas = paginacao.totalPaginas;

		elementos.lista.replaceChildren(...itens.map(criarItem));

		const vazia = itens.length === 0;
		elementos.lista.hidden = vazia;
		elementos.vazio.hidden = !vazia;
		elementos.paginacao.hidden = totalPaginas <= 1;

		elementos.indicador.textContent = `Página ${paginaAtual} de ${totalPaginas}`;
		elementos.anterior.disabled = paginaAtual <= 1;
		elementos.seguinte.disabled = paginaAtual >= totalPaginas;
	} catch (erro) {
		tratar(erro);
		elementos.lista.hidden = true;
		elementos.vazio.hidden = true;
	} finally {
		elementos.carregando.hidden = true;
	}
}

/* ---------------------------------------------------------------------
 *  Apagar
 * ------------------------------------------------------------------- */

function abrirApagar(item) {
	itemSelecionado = item;
	elementos.nomeParaApagar.textContent = item.nome;
	elementos.dialogoApagar.showModal();
}

elementos.cancelarApagar?.addEventListener("click", () => {
	elementos.dialogoApagar.close();
	itemSelecionado = null;
});

elementos.confirmarApagar?.addEventListener("click", async () => {
	if (!itemSelecionado) return;

	const item = itemSelecionado;
	elementos.confirmarApagar.disabled = true;

	try {
		await biblioteca.apagar(item.id);
		elementos.dialogoApagar.close();
		avisar(`"${item.nome}" foi apagado.`);

		// Se a pagina ficou vazia depois de apagar, volta uma - senao o
		// usuario olharia para uma pagina em branco que existe apenas
		// porque ele acabou de esvazia-la.
		const deveVoltar = elementos.lista.children.length === 1 && paginaAtual > 1;
		await carregar(deveVoltar ? paginaAtual - 1 : paginaAtual);
	} catch (erro) {
		elementos.dialogoApagar.close();
		tratar(erro);
	} finally {
		elementos.confirmarApagar.disabled = false;
		itemSelecionado = null;
	}
});

/* ---------------------------------------------------------------------
 *  Renomear
 * ------------------------------------------------------------------- */

function abrirRenomear(item) {
	itemSelecionado = item;
	elementos.novoNome.value = item.nome;
	elementos.dialogoRenomear.showModal();

	// Seleciona so o nome, deixando a extensao de fora: quase sempre e o
	// nome que se quer trocar, e a extensao e mantida a forca pelo
	// servidor de qualquer modo.
	const ponto = item.nome.lastIndexOf(".");
	elementos.novoNome.focus();
	elementos.novoNome.setSelectionRange(0, ponto > 0 ? ponto : item.nome.length);
}

elementos.cancelarRenomear?.addEventListener("click", () => {
	elementos.dialogoRenomear.close();
	itemSelecionado = null;
});

elementos.confirmarRenomear?.addEventListener("click", async () => {
	if (!itemSelecionado) return;

	const nome = elementos.novoNome.value.trim();
	if (nome.length === 0) {
		elementos.novoNome.focus();
		return;
	}

	elementos.confirmarRenomear.disabled = true;

	try {
		await biblioteca.renomear(itemSelecionado.id, nome);
		elementos.dialogoRenomear.close();
		avisar("Nome alterado.");
		await carregar(paginaAtual);
	} catch (erro) {
		elementos.dialogoRenomear.close();
		tratar(erro);
	} finally {
		elementos.confirmarRenomear.disabled = false;
		itemSelecionado = null;
	}
});

/* ---------------------------------------------------------------------
 *  Paginacao e inicio
 * ------------------------------------------------------------------- */

elementos.anterior?.addEventListener("click", () => carregar(paginaAtual - 1));
elementos.seguinte?.addEventListener("click", () => carregar(paginaAtual + 1));

// exigirSessao monta a barra de navegacao e redireciona quem nao tem
// sessao. E conveniencia, nao protecao: a API recusaria os dados de
// qualquer forma.
exigirSessao().then((usuario) => {
	if (usuario) carregar(1);
});
