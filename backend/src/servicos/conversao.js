/**
 * Conversao de arquivos no servidor.
 *
 * O servidor nao reimplementa nenhum formato: ele orquestra ferramentas
 * que ja existem no sistema. O trabalho deste modulo e tres coisas -
 * descobrir quais ferramentas estao disponiveis, passar os arquivos por
 * elas com seguranca, e nao deixar lixo para tras.
 *
 * SEGURANCA, o ponto central: nenhum comando passa por um shell. Tudo
 * usa execFile com argumentos em array. A diferenca importa:
 *
 *     exec(`soffice --convert-to pdf ${caminho}`)   // um shell interpreta
 *     execFile("soffice", ["--convert-to","pdf",caminho])   // nao ha shell
 *
 * Na primeira forma, um caminho contendo "; rm -rf ~" executaria os dois
 * comandos. Na segunda, o mesmo texto chega ao programa como um nome de
 * arquivo esquisito e nada mais. Os caminhos aqui ja sao gerados pelo
 * servidor, entao a injecao seria dificil de alcancar - mas o custo de
 * usar a forma segura e zero.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import { config } from "../config/index.js";
import { erros } from "../util/erros.js";
import { validarConteudo, FORMATOS } from "../util/formatos.js";
import { escrever } from "../util/logger.js";
import { Fila, FilaCheiaError } from "./fila.js";

const executarArquivo = promisify(execFile);

/** Instancia unica da fila, configurada pelo .env. */
export const filaConversao = new Fila({
	concorrencia: config.conversao.concorrencia,
	tamanhoMaximo: config.conversao.filaMaxima,
});

/* ---------------------------------------------------------------------
 *  Ferramentas
 * ------------------------------------------------------------------- */

const FERRAMENTAS = {
	sharp: { tipo: "modulo", nome: "sharp", descricao: "imagens (npm)" },
	pdftoppm: { tipo: "binario", nome: "pdftoppm", descricao: "PDF para imagem (poppler-utils)" },
	pdftotext: { tipo: "binario", nome: "pdftotext", descricao: "PDF para texto (poppler-utils)" },
	img2pdf: { tipo: "binario", nome: "img2pdf", descricao: "imagem para PDF" },
	soffice: { tipo: "binario", nome: "soffice", descricao: "documentos (LibreOffice)" },
};

/** Preenchido na subida por detectarFerramentas(). */
let disponiveis = new Set();
let sharpModulo = null;

async function binarioExiste(comando) {
	try {
		await executarArquivo("which", [comando], { timeout: 3000 });
		return true;
	} catch {
		return false;
	}
}

/**
 * Descobre o que esta instalado.
 *
 * Chamado uma vez na subida. Permite que o sistema funcione com o que
 * houver: sem o LibreOffice, as conversoes de documento simplesmente nao
 * sao oferecidas, em vez de falharem na cara do usuario.
 */
export async function detectarFerramentas() {
	const encontradas = new Set();

	try {
		const modulo = await import("sharp");
		sharpModulo = modulo.default ?? modulo;
		encontradas.add("sharp");
	} catch {
		// sharp nao instalado: as conversoes de imagem ficam de fora.
	}

	for (const [chave, ferramenta] of Object.entries(FERRAMENTAS)) {
		if (ferramenta.tipo === "binario" && (await binarioExiste(ferramenta.nome))) {
			encontradas.add(chave);
		}
	}

	disponiveis = encontradas;

	const faltando = Object.keys(FERRAMENTAS).filter((f) => !encontradas.has(f));
	escrever("info", "ferramentas_detectadas", {
		detalhe:
			`disponiveis=[${[...encontradas].join(", ")}]` +
			(faltando.length ? ` ausentes=[${faltando.join(", ")}]` : ""),
	});

	return encontradas;
}

/* ---------------------------------------------------------------------
 *  Executores
 *
 *  Cada um recebe o caminho de entrada e o diretorio de trabalho, e
 *  devolve o caminho do arquivo produzido.
 * ------------------------------------------------------------------- */

const IMAGENS_SHARP = ["jpg", "jpeg", "png", "webp", "avif", "tiff", "gif"];

async function viaSharp(entrada, dir, para) {
	const saida = path.join(dir, `saida.${para}`);

	// O sharp decodifica e recodifica: metadados (EXIF, geolocalizacao)
	// nao sobrevivem. E o mesmo efeito do canvas no navegador, e aqui
	// tambem joga a favor da privacidade.
	let imagem = sharpModulo(entrada, { failOn: "error" });

	if (para === "jpg" || para === "jpeg") {
		// JPEG nao tem canal alfa: sem o fundo branco, a transparencia
		// de um PNG vira preto.
		imagem = imagem.flatten({ background: "#ffffff" }).jpeg({ quality: 90 });
	} else if (para === "png") {
		imagem = imagem.png({ compressionLevel: 9 });
	} else if (para === "webp") {
		imagem = imagem.webp({ quality: 90 });
	} else if (para === "avif") {
		imagem = imagem.avif({ quality: 70 });
	} else if (para === "tiff") {
		imagem = imagem.tiff();
	}

	await imagem.toFile(saida);
	return saida;
}

async function viaPdftoppm(entrada, dir, para) {
	const prefixo = path.join(dir, "saida");

	// -singlefile converte so a primeira pagina e produz exatamente
	// "saida.png", sem o sufixo numerico que o pdftoppm usaria.
	await executarArquivo(
		"pdftoppm",
		[para === "jpg" ? "-jpeg" : "-png", "-singlefile", "-r", "150", entrada, prefixo],
		{ timeout: config.conversao.timeoutMs },
	);

	return `${prefixo}.${para === "jpg" ? "jpg" : "png"}`;
}

async function viaPdftotext(entrada, dir) {
	const saida = path.join(dir, "saida.txt");
	await executarArquivo("pdftotext", ["-layout", "-enc", "UTF-8", entrada, saida], {
		timeout: config.conversao.timeoutMs,
	});
	return saida;
}

/**
 * Imagem para PDF, em duas etapas.
 *
 * O img2pdf so aceita JPEG e PNG. Para WEBP, AVIF e TIFF, o sharp
 * normaliza para PNG antes. Encadear duas ferramentas simples e melhor
 * do que trazer o ImageMagick, que carrega uma superficie de ataque bem
 * maior por causa dos delegados.
 */
async function viaImg2pdf(entrada, dir, para, de) {
	let origem = entrada;

	if (de !== "jpg" && de !== "jpeg" && de !== "png") {
		if (!disponiveis.has("sharp")) {
			throw erros.formatoNaoSuportado(`Conversao de ${de} para PDF indisponivel.`);
		}
		origem = path.join(dir, "normalizada.png");
		await sharpModulo(entrada).png().toFile(origem);
	}

	const saida = path.join(dir, "saida.pdf");
	await executarArquivo("img2pdf", [origem, "-o", saida], {
		timeout: config.conversao.timeoutMs,
	});
	return saida;
}

async function viaLibreOffice(entrada, dir) {
	// Perfil proprio por conversao. Sem isto, duas execucoes simultaneas
	// disputam o mesmo perfil de usuario e uma delas falha com "already
	// running" - problema que so aparece sob concorrencia, que e
	// exatamente o que a fila permite.
	const perfil = path.join(dir, "perfil-lo");

	await executarArquivo(
		"soffice",
		[
			"--headless",
			"--norestore",
			"--invisible",
			`-env:UserInstallation=file://${perfil}`,
			"--convert-to",
			"pdf",
			"--outdir",
			dir,
			entrada,
		],
		{ timeout: config.conversao.timeoutMs },
	);

	// O soffice nomeia a saida pelo nome da entrada, trocando a extensao.
	const base = path.basename(entrada, path.extname(entrada));
	return path.join(dir, `${base}.pdf`);
}

/* ---------------------------------------------------------------------
 *  Tabela de conversoes
 * ------------------------------------------------------------------- */

const DOCUMENTOS = ["docx", "xlsx", "pptx", "odt", "ods"];

function montarTabela() {
	const tabela = [];

	// imagem -> imagem, todos os pares de formatos diferentes
	for (const de of IMAGENS_SHARP) {
		for (const para of IMAGENS_SHARP) {
			if (de === para) continue;
			if (de === "jpg" && para === "jpeg") continue;
			if (de === "jpeg" && para === "jpg") continue;
			tabela.push({ de, para, ferramenta: "sharp", executor: viaSharp });
		}
	}

	// imagem -> pdf
	for (const de of IMAGENS_SHARP) {
		tabela.push({ de, para: "pdf", ferramenta: "img2pdf", executor: viaImg2pdf });
	}

	// pdf -> imagem e pdf -> texto
	tabela.push({ de: "pdf", para: "png", ferramenta: "pdftoppm", executor: viaPdftoppm });
	tabela.push({ de: "pdf", para: "jpg", ferramenta: "pdftoppm", executor: viaPdftoppm });
	tabela.push({ de: "pdf", para: "txt", ferramenta: "pdftotext", executor: viaPdftotext });

	// documentos -> pdf
	for (const de of DOCUMENTOS) {
		tabela.push({ de, para: "pdf", ferramenta: "soffice", executor: viaLibreOffice });
	}

	return tabela;
}

const TABELA = montarTabela();

/** Conversoes que o servidor consegue fazer AGORA, com o que esta instalado. */
export function conversoesDisponiveis() {
	const porOrigem = {};

	for (const item of TABELA) {
		if (!disponiveis.has(item.ferramenta)) continue;
		(porOrigem[item.de] ??= []).push(item.para);
	}

	return porOrigem;
}

function encontrar(de, para) {
	return TABELA.find((item) => item.de === de && item.para === para) ?? null;
}

/* ---------------------------------------------------------------------
 *  Conversao
 * ------------------------------------------------------------------- */

/**
 * Converte um buffer. Passa pela fila; o diretorio temporario e sempre
 * removido, inclusive quando a conversao falha.
 *
 * @returns {Promise<{buffer: Buffer, formato: string, tipoMime: string}>}
 */
export async function converter({ buffer, de, para }) {
	const origem = String(de ?? "").toLowerCase();
	const destino = String(para ?? "").toLowerCase();

	if (!Object.hasOwn(FORMATOS, origem) || !Object.hasOwn(FORMATOS, destino)) {
		throw erros.formatoNaoSuportado("Formato de origem ou de destino desconhecido.");
	}

	const conversao = encontrar(origem, destino);
	if (!conversao) {
		throw erros.formatoNaoSuportado(
			`Nao ha conversao de ${origem.toUpperCase()} para ${destino.toUpperCase()}.`,
		);
	}
	if (!disponiveis.has(conversao.ferramenta)) {
		throw erros.formatoNaoSuportado(
			`A conversao de ${origem.toUpperCase()} para ${destino.toUpperCase()} ` +
				"esta indisponivel neste servidor.",
		);
	}

	// O conteudo e conferido ANTES de qualquer ferramenta tocar nele:
	// nenhum conversor recebe arquivo que nao foi validado.
	validarConteudo(buffer, origem);

	try {
		return await filaConversao.executar(() =>
			executarConversao({ buffer, origem, destino, conversao }),
		);
	} catch (erro) {
		if (erro instanceof FilaCheiaError) throw erros.servidorOcupado();
		throw erro;
	}
}

async function executarConversao({ buffer, origem, destino, conversao }) {
	// mkdtemp gera um diretorio com sufixo aleatorio, o que evita colisao
	// entre conversoes simultaneas e corrida de link simbolico em /tmp.
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "freevertio-"));
	const entrada = path.join(dir, `${randomUUID()}.${origem}`);

	const inicio = Date.now();

	try {
		await fs.writeFile(entrada, buffer, { mode: 0o600 });

		const saida = await conversao.executor(entrada, dir, destino, origem);
		const resultado = await fs.readFile(saida);

		if (resultado.length === 0) {
			throw erros.falhaConversao("A conversao produziu um arquivo vazio.");
		}

		escrever("info", "conversao_concluida", {
			detalhe:
				`${origem}->${destino} via ${conversao.ferramenta} ` +
				`${buffer.length}B->${resultado.length}B em ${Date.now() - inicio}ms`,
		});

		return {
			buffer: resultado,
			formato: destino,
			tipoMime: FORMATOS[destino].mime,
		};
	} catch (erro) {
		if (erro.previsto) throw erro;

		// Processo morto pelo timeout.
		if (erro.killed || erro.signal === "SIGTERM") {
			throw erros.falhaConversao(
				`A conversao excedeu o tempo limite de ${config.conversao.timeoutMs / 1000}s.`,
			);
		}

		// Falha da ferramenta: a mensagem original pode conter caminho de
		// arquivo e detalhe interno, entao fica no log e nao na resposta.
		escrever("erro", "falha_na_conversao", {
			detalhe: `${origem}->${destino} via ${conversao.ferramenta} :: ${erro.message}`,
		});
		throw erros.falhaConversao(
			"Nao foi possivel converter este arquivo. Verifique se ele nao esta corrompido.",
		);
	} finally {
		// Sem este finally, cada conversao que falha deixa lixo
		// permanente em /tmp.
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}
