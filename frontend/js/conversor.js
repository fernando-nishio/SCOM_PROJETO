/**
 * Conversor do Freevertio.
 *
 * Continua fazendo no navegador tudo o que o navegador sabe fazer. O que
 * mudou no Trabalho II: formatos que o navegador NAO alcanca passaram a
 * existir, e esses exigem enviar o arquivo ao servidor.
 *
 * O envio nunca e automatico. Sao DOIS consentimentos, separados e
 * independentes:
 *
 *   1. enviar o arquivo para ser convertido  (so quando o formato exige)
 *   2. guardar o resultado na biblioteca     (so para quem tem conta)
 *
 * Juntar os dois numa caixa so seria exatamente o que foi criticado nos
 * servicos concorrentes, na Secao 2 do relatorio do Trabalho I.
 */

import { conversoes, biblioteca, ErroApi, ErroDeRede } from "./api.js";
import { montarBarraDeSessao } from "./sessao-ui.js";

/* ---------------------------------------------------------------------
 *  Estado
 * ------------------------------------------------------------------- */

let arquivoAtual = null;
let categoriaDetectada = null;
let urlDownloadAnterior = null;
let usuarioLogado = null;
let formatosDoServidor = {};
let cancelador = null;

/* ---------------------------------------------------------------------
 *  Tabelas de conversao local
 *
 *  Mantidas como tabela, e nao como cadeia de if: acrescentar um formato
 *  e acrescentar uma linha.
 * ------------------------------------------------------------------- */

const FORMATOS_IMAGEM = [
	{ rotulo: "JPEG (.jpg)", valor: "image/jpeg", ext: "jpg" },
	{ rotulo: "PNG (.png)", valor: "image/png", ext: "png" },
	{ rotulo: "WEBP (.webp)", valor: "image/webp", ext: "webp" },
];

const FORMATOS_DADOS = {
	csv: [
		{ rotulo: "JSON (.json)", valor: "json", ext: "json" },
		{ rotulo: "Texto em maiúsculas (.txt)", valor: "maiusculas", ext: "txt" },
	],
	json: [
		{ rotulo: "CSV (.csv)", valor: "csv", ext: "csv" },
		{ rotulo: "Texto em maiúsculas (.txt)", valor: "maiusculas", ext: "txt" },
	],
	txt: [{ rotulo: "Texto em maiúsculas (.txt)", valor: "maiusculas", ext: "txt" }],
};

const EXTENSOES_IMAGEM = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};

const NOMES_FORMATO = {
	pdf: "PDF (.pdf)",
	png: "PNG (.png)",
	jpg: "JPEG (.jpg)",
	webp: "WEBP (.webp)",
	avif: "AVIF (.avif)",
	tiff: "TIFF (.tiff)",
	gif: "GIF (.gif)",
	txt: "Texto (.txt)",
};

/* ---------------------------------------------------------------------
 *  Elementos
 * ------------------------------------------------------------------- */

const el = {
	input: document.getElementById("arquivo_input"),
	info: document.getElementById("info_arquivo"),
	nome: document.getElementById("nome_arquivo"),
	tipo: document.getElementById("tipo_arquivo"),
	controle: document.getElementById("controle_conversao"),
	select: document.getElementById("formato_select"),
	botao: document.getElementById("botao_converter"),
	saida: document.getElementById("area_saida"),

	avisoServidor: document.getElementById("aviso_servidor"),
	aceitaEnvio: document.getElementById("aceita_envio"),
	caixaGuardar: document.getElementById("caixa_guardar"),
	guardar: document.getElementById("guardar_biblioteca"),
	espera: document.getElementById("estado_espera"),
	textoEspera: document.getElementById("texto_espera"),
	cancelar: document.getElementById("botao_cancelar"),
	avisoOffline: document.getElementById("aviso_offline"),
};

el.input?.addEventListener("change", prepararArquivo);
el.botao?.addEventListener("click", converter);
el.aceitaEnvio?.addEventListener("change", atualizarBotao);
el.select?.addEventListener("change", aoTrocarFormato);
el.cancelar?.addEventListener("click", () => cancelador?.abort());

/* ---------------------------------------------------------------------
 *  Inicio
 * ------------------------------------------------------------------- */

iniciar();

async function iniciar() {
	usuarioLogado = await montarBarraDeSessao();

	try {
		const resposta = await conversoes.formatos();
		formatosDoServidor = resposta.servidor ?? {};
	} catch {
		// Servidor fora do ar. A conversao local nao depende dele, entao a
		// pagina continua util - so perde os formatos extras. Dizer isso e
		// melhor do que deixar o usuario descobrir sozinho.
		formatosDoServidor = {};
		if (el.avisoOffline) el.avisoOffline.hidden = false;
	}
}

/* ---------------------------------------------------------------------
 *  Montagem das opcoes
 * ------------------------------------------------------------------- */

/**
 * Lista as conversoes possiveis para a extensao dada, cada uma marcada
 * com onde ela roda.
 *
 * @returns {{rotulo: string, valor: string, ext: string, modo: "local"|"servidor"}[]}
 */
function obterFormatos(extensao) {
	const opcoes = [];

	if (EXTENSOES_IMAGEM[extensao]) {
		categoriaDetectada = "imagem";
		for (const f of FORMATOS_IMAGEM) {
			if (f.valor !== EXTENSOES_IMAGEM[extensao]) opcoes.push({ ...f, modo: "local" });
		}
	} else if (FORMATOS_DADOS[extensao]) {
		categoriaDetectada = "dados";
		for (const f of FORMATOS_DADOS[extensao]) opcoes.push({ ...f, modo: "local" });
	} else {
		categoriaDetectada = null;
	}

	// Acrescenta o que so o servidor faz, sem repetir o que ja esta na
	// lista local - o navegador sempre tem preferencia.
	const jaOferecidos = new Set(opcoes.map((o) => o.ext));

	for (const destino of formatosDoServidor[extensao] ?? []) {
		if (jaOferecidos.has(destino)) continue;

		opcoes.push({
			rotulo: `${NOMES_FORMATO[destino] ?? destino.toUpperCase()} — no servidor`,
			valor: `servidor:${destino}`,
			ext: destino,
			modo: "servidor",
		});

		if (categoriaDetectada === null) categoriaDetectada = "servidor";
	}

	return opcoes;
}

function prepararArquivo() {
	if (!el.input?.files?.[0]) return;

	arquivoAtual = el.input.files[0];
	const extensao = arquivoAtual.name.split(".").pop().toLowerCase();
	const formatos = obterFormatos(extensao);

	el.nome.textContent = arquivoAtual.name;
	el.info.hidden = false;
	limparSaida();
	esconderConsentimentos();

	if (formatos.length === 0) {
		el.tipo.textContent = "Não suportado";
		el.controle.hidden = true;
		mostrarErro(`O formato ".${extensao}" não é suportado para conversão.`);
		return;
	}

	el.tipo.textContent =
		categoriaDetectada === "imagem"
			? "Imagem"
			: categoriaDetectada === "dados"
				? "Texto / Dados"
				: "Documento";

	el.select.replaceChildren(
		...formatos.map((formato) => {
			const opcao = document.createElement("option");
			opcao.value = formato.valor;
			opcao.textContent = formato.rotulo;
			opcao.dataset.ext = formato.ext;
			opcao.dataset.modo = formato.modo;
			return opcao;
		}),
	);

	el.controle.hidden = false;
	aoTrocarFormato();
}

/* ---------------------------------------------------------------------
 *  Consentimento
 * ------------------------------------------------------------------- */

function modoSelecionado() {
	return el.select?.selectedOptions[0]?.dataset.modo ?? "local";
}

function esconderConsentimentos() {
	if (el.avisoServidor) el.avisoServidor.hidden = true;
	if (el.aceitaEnvio) el.aceitaEnvio.checked = false;
	if (el.caixaGuardar) el.caixaGuardar.hidden = true;
	if (el.guardar) el.guardar.checked = false;
}

/**
 * Mostra cada consentimento somente quando ele se aplica.
 *
 * O caminho local continua em tres cliques, sem friccao nova: a caixa de
 * autorizacao de envio simplesmente nao aparece.
 */
function aoTrocarFormato() {
	const noServidor = modoSelecionado() === "servidor";

	if (el.avisoServidor) {
		el.avisoServidor.hidden = !noServidor;
		if (!noServidor && el.aceitaEnvio) el.aceitaEnvio.checked = false;
	}

	// Guardar exige conta, e e um consentimento SEPARADO do de enviar:
	// da para converter no servidor sem guardar nada.
	if (el.caixaGuardar) {
		el.caixaGuardar.hidden = usuarioLogado === null;
	}

	atualizarBotao();
}

function atualizarBotao() {
	if (!el.botao) return;

	const precisaAutorizar = modoSelecionado() === "servidor";
	el.botao.disabled = precisaAutorizar && !el.aceitaEnvio?.checked;
}

/* ---------------------------------------------------------------------
 *  Conversao
 * ------------------------------------------------------------------- */

function converter() {
	if (!arquivoAtual) return;

	const opcao = el.select.selectedOptions[0];
	const ext = opcao.dataset.ext;

	if (opcao.dataset.modo === "servidor") {
		converterNoServidor(ext);
	} else if (categoriaDetectada === "imagem") {
		converterImagem(arquivoAtual, opcao.value, ext);
	} else {
		converterDados(arquivoAtual, opcao.value, ext);
	}
}

/* --- navegador ------------------------------------------------------ */

function converterImagem(arquivo, formato, ext) {
	const leitor = new FileReader();

	leitor.onload = (evento) => {
		const imagem = new Image();

		imagem.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = imagem.width;
			canvas.height = imagem.height;
			const ctx = canvas.getContext("2d");

			// JPEG não tem canal alfa: sem o fundo branco, a transparência
			// de um PNG vira preto.
			if (formato === "image/jpeg") {
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}

			ctx.drawImage(imagem, 0, 0);
			canvas.toBlob(
				(blob) => concluir(blob, trocarExtensao(arquivo.name, ext), ext, "local"),
				formato,
				0.9,
			);
		};

		imagem.onerror = () => mostrarErro("Não foi possível ler a imagem.");
		imagem.src = evento.target.result;
	};

	leitor.readAsDataURL(arquivo);
}

function csvParaJson(texto) {
	const linhas = texto.split(/\r?\n/).filter((linha) => linha.trim() !== "");
	const cabecalho = linhas.shift().split(",").map((c) => c.trim());

	const registros = linhas.map((linha) => {
		const valores = linha.split(",");
		const registro = {};
		cabecalho.forEach((coluna, i) => {
			registro[coluna] = (valores[i] || "").trim();
		});
		return registro;
	});

	return JSON.stringify(registros, null, 2);
}

function jsonParaCsv(texto) {
	const dados = JSON.parse(texto);
	const lista = Array.isArray(dados) ? dados : [dados];
	const colunas = [...new Set(lista.flatMap((item) => Object.keys(item)))];

	// Escapa o valor conforme o RFC 4180: campo com vírgula, aspas ou
	// quebra de linha vai entre aspas, e as aspas internas são dobradas.
	// A versão do Trabalho I não fazia isso e produzia CSV quebrado.
	const escapar = (valor) => {
		const texto = String(valor ?? "");
		return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
	};

	const linhas = lista.map((item) => colunas.map((c) => escapar(item[c])).join(","));
	return [colunas.map(escapar).join(","), ...linhas].join("\n");
}

function converterDados(arquivo, formato, ext) {
	const leitor = new FileReader();

	leitor.onload = (evento) => {
		const conteudo = evento.target.result;

		try {
			let convertido = "";
			if (formato === "json") convertido = csvParaJson(conteudo);
			else if (formato === "csv") convertido = jsonParaCsv(conteudo);
			else if (formato === "maiusculas") convertido = conteudo.toUpperCase();

			concluir(
				new Blob([convertido], { type: "text/plain" }),
				trocarExtensao(arquivo.name, ext),
				ext,
				"local",
			);
		} catch {
			mostrarErro("Erro na conversão. Verifique se o arquivo está formatado corretamente.");
		}
	};

	leitor.readAsText(arquivo);
}

/* --- servidor ------------------------------------------------------- */

async function converterNoServidor(ext) {
	cancelador = new AbortController();
	mostrarEspera("Enviando o arquivo…");

	try {
		const { blob, itemId } = await conversoes.converter({
			arquivo: arquivoAtual,
			formatoDestino: ext,
			guardar: Boolean(el.guardar?.checked),
			sinal: cancelador.signal,
		});

		esconderEspera();
		mostrarDownload(blob, trocarExtensao(arquivoAtual.name, ext));

		if (itemId) {
			avisarGuardado();
		}
	} catch (erro) {
		esconderEspera();

		if (erro.name === "AbortError") {
			mostrarErro("Conversão cancelada.");
		} else if (erro instanceof ErroApi) {
			mostrarErro(erro.mensagem);
		} else if (erro instanceof ErroDeRede) {
			mostrarErro(erro.message);
		} else {
			mostrarErro("Não foi possível converter este arquivo.");
		}
	} finally {
		cancelador = null;
	}
}

/* ---------------------------------------------------------------------
 *  Conclusao
 * ------------------------------------------------------------------- */

/**
 * Fecha o fluxo de uma conversao local: mostra o download e, se o
 * usuario pediu, envia o resultado para a biblioteca.
 *
 * Repare na ordem: o download aparece PRIMEIRO. Guardar e um extra, e o
 * usuario nao pode ficar esperando um upload para receber o arquivo que
 * ja esta pronto na maquina dele.
 */
async function concluir(blob, nomeSaida, ext, origem) {
	mostrarDownload(blob, nomeSaida);

	if (origem !== "local" || !usuarioLogado || !el.guardar?.checked) return;

	try {
		await biblioteca.guardar({
			blob,
			nome: nomeSaida,
			formatoOrigem: arquivoAtual.name.split(".").pop().toLowerCase(),
			formatoDestino: ext,
		});
		avisarGuardado();
	} catch (erro) {
		// O arquivo convertido continua disponivel para baixar. Falhar ao
		// guardar nao pode apagar o resultado da tela.
		const aviso = document.createElement("p");
		aviso.className = "mensagem_erro";
		aviso.textContent =
			erro instanceof ErroApi
				? `O arquivo foi convertido, mas não foi guardado: ${erro.mensagem}`
				: "O arquivo foi convertido, mas não foi possível guardá-lo.";
		el.saida.appendChild(aviso);
	}
}

function avisarGuardado() {
	const aviso = document.createElement("p");
	aviso.className = "mensagem_sucesso";

	const texto = document.createTextNode("Guardado na sua biblioteca. ");
	const link = document.createElement("a");
	link.href = "biblioteca.html";
	link.textContent = "Ver biblioteca";

	aviso.append(texto, link);
	el.saida.appendChild(aviso);
}

/* ---------------------------------------------------------------------
 *  Interface de saida
 * ------------------------------------------------------------------- */

function trocarExtensao(nome, extensao) {
	const ponto = nome.lastIndexOf(".");
	const base = ponto > 0 ? nome.slice(0, ponto) : nome;
	return `${base}.${extensao}`;
}

function mostrarEspera(texto) {
	limparSaida();
	if (el.espera) el.espera.hidden = false;
	if (el.textoEspera) el.textoEspera.textContent = texto;
	if (el.botao) el.botao.disabled = true;
}

function esconderEspera() {
	if (el.espera) el.espera.hidden = true;
	atualizarBotao();
}

function limparSaida() {
	// createObjectURL segura o Blob vivo na memoria ate ser revogado.
	// Sem isto, converter dez arquivos grandes deixa dez copias presas
	// ate a aba fechar.
	if (urlDownloadAnterior) {
		URL.revokeObjectURL(urlDownloadAnterior);
		urlDownloadAnterior = null;
	}
	el.saida?.replaceChildren();
}

function mostrarErro(mensagem) {
	limparSaida();

	const p = document.createElement("p");
	p.className = "mensagem_erro";
	p.setAttribute("role", "alert");
	p.textContent = mensagem;    // textContent: o nome do arquivo entra aqui
	el.saida.appendChild(p);
}

function mostrarDownload(blob, nome) {
	limparSaida();
	urlDownloadAnterior = URL.createObjectURL(blob);

	const aviso = document.createElement("p");
	aviso.className = "file_info";
	aviso.textContent = "Conversão concluída!";

	const link = document.createElement("a");
	link.href = urlDownloadAnterior;
	link.download = nome;
	link.className = "botao_primario";
	link.textContent = `Baixar ${nome}`;

	el.saida.append(aviso, link);

	// Leva o foco ao link: quem navega por teclado nao precisa procurar
	// o resultado da acao que acabou de executar.
	link.focus();
}
