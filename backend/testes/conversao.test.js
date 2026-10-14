/**
 * Testes de integracao da conversao no servidor.
 *
 * Diferente dos outros arquivos de teste, estes exercitam as ferramentas
 * externas de verdade: escrevem arquivo em disco, executam pdftoppm,
 * img2pdf e LibreOffice, e conferem o resultado pela assinatura dos
 * bytes produzidos.
 *
 * Cada teste e PULADO quando a ferramenta correspondente nao esta
 * instalada, em vez de falhar. Assim a suite continua verde numa maquina
 * que so tem parte do ambiente, e o relatorio de execucao mostra
 * exatamente o que foi exercitado.
 *
 * Exige backend/.env configurado (o modulo de conversao carrega config).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
	detectarFerramentas,
	conversoesDisponiveis,
	converter,
	filaConversao,
} from "../src/servicos/conversao.js";
import { detectarPorAssinatura, ehTextoUtf8 } from "../src/util/formatos.js";

/** PNG 4x4 roxo, valido e completo. Embutido para que a suite nao
 *  dependa de ferramenta nenhuma para montar a amostra de entrada. */
const PNG_AMOSTRA = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAQMAAACTPww9AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1" +
		"MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURZ4So////8dLmucAAAABYktHRAH/Ai3eAAAAB3RJTUUH6goN" +
		"DDQGmIL9ngAAAAtJREFUCNdjYIAAAAAIAAEvIN0xAAAAAElFTkSuQmCC",
	"base64",
);

/** PDF 200x100 com o texto "Freevertio SCOM", escrito a mao byte a byte.
 *  Embutido para que os testes de PDF nao dependam do img2pdf para
 *  montar a entrada - assim eles rodam em qualquer maquina que tenha o
 *  poppler, mesmo sem as outras ferramentas. */
const PDF_AMOSTRA = Buffer.from(
		"JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2Jq" +
		"CjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2Jq" +
		"CjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAg" +
		"MTAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAw" +
		"IFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NSA+PgpzdHJlYW0KQlQgL0YxIDE0IFRm" +
		"IDIwIDUwIFRkIChGcmVldmVydGlvIFNDT00pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9i" +
		"ago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4K" +
		"ZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAow" +
		"MDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBu" +
		"IAowMDAwMDAwMzM2IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+Pgpz" +
		"dGFydHhyZWYKNDA2CiUlRU9GCg==" ,
	"base64",
);

let ferramentas = new Set();

test("detectarFerramentas encontra o que esta instalado", async () => {
	ferramentas = await detectarFerramentas();

	assert.ok(ferramentas instanceof Set);
	console.log(`      ferramentas: ${[...ferramentas].join(", ") || "nenhuma"}`);
});

test("conversoesDisponiveis so oferece o que as ferramentas suportam", () => {
	const disponiveis = conversoesDisponiveis();

	for (const [de, destinos] of Object.entries(disponiveis)) {
		assert.ok(destinos.length > 0, `${de} sem destinos`);
		assert.ok(!destinos.includes(de), `${de} nao deve converter para si mesmo`);
	}

	// Sem LibreOffice, DOCX nao pode aparecer na lista.
	if (!ferramentas.has("soffice")) {
		assert.equal(disponiveis.docx, undefined);
	}
});

test("recusa par de formatos para o qual nao existe conversao", async () => {
	await assert.rejects(
		() => converter({ buffer: PNG_AMOSTRA, de: "png", para: "csv" }),
		/Nao ha conversao/,
	);
});

test("recusa formato desconhecido", async () => {
	await assert.rejects(
		() => converter({ buffer: PNG_AMOSTRA, de: "exe", para: "pdf" }),
		/desconhecido/,
	);
});

test("recusa conteudo que nao corresponde ao formato declarado", async (t) => {
	// O par de formatos e escolhido entre os DISPONIVEIS nesta maquina.
	//
	// Fixar um par (png->pdf, digamos) acoplaria um teste de VALIDACAO a
	// quais ferramentas estao instaladas: sem o img2pdf, o erro de
	// "conversao indisponivel" dispara antes e o teste falha por um
	// motivo que nada tem a ver com o que ele verifica.
	const disponiveis = conversoesDisponiveis();
	const origem = ["png", "jpg", "webp", "pdf", "docx"].find(
		(formato) => disponiveis[formato]?.length > 0,
	);

	if (!origem) return t.skip("nenhuma conversao disponivel neste servidor");

	const destino = disponiveis[origem][0];

	// Texto qualquer apresentado como arquivo binario: a validacao
	// acontece ANTES de qualquer ferramenta receber o arquivo.
	await assert.rejects(
		() =>
			converter({
				buffer: Buffer.from("isto nao e um arquivo valido"),
				de: origem,
				para: destino,
			}),
		/nao corresponde|dados binarios/,
		`${origem} -> ${destino} deveria recusar o conteudo`,
	);
});

/* --- conversoes reais ---------------------------------------------- */

test("PNG para PDF produz um PDF valido", async (t) => {
	if (!ferramentas.has("img2pdf")) return t.skip("img2pdf nao instalado");

	const { buffer, formato, tipoMime } = await converter({
		buffer: PNG_AMOSTRA,
		de: "png",
		para: "pdf",
	});

	assert.equal(formato, "pdf");
	assert.equal(tipoMime, "application/pdf");
	assert.equal(detectarPorAssinatura(buffer), "pdf", "a saida precisa ter assinatura de PDF");
	assert.ok(buffer.length > 100);
});

test("PDF para PNG produz uma imagem valida", async (t) => {
	if (!ferramentas.has("pdftoppm")) return t.skip("pdftoppm nao instalado");

	const png = await converter({ buffer: PDF_AMOSTRA, de: "pdf", para: "png" });

	assert.equal(png.formato, "png");
	assert.equal(detectarPorAssinatura(png.buffer), "png");
	assert.ok(png.buffer.length > 100);
});

test("PDF para TXT extrai o texto do documento", async (t) => {
	if (!ferramentas.has("pdftotext")) return t.skip("pdftotext nao instalado");

	const txt = await converter({ buffer: PDF_AMOSTRA, de: "pdf", para: "txt" });

	assert.equal(txt.formato, "txt");
	assert.ok(ehTextoUtf8(txt.buffer), "a saida precisa ser texto UTF-8 valido");

	// Nao basta o comando nao ter dado erro: o texto que estava no PDF
	// precisa aparecer na saida.
	assert.match(txt.buffer.toString("utf8"), /Freevertio SCOM/);
});

test("DOCX para PDF usa o LibreOffice", async (t) => {
	if (!ferramentas.has("soffice")) return t.skip("LibreOffice nao instalado");

	// Gera um DOCX de verdade a partir de um texto, com a propria
	// ferramenta que sera testada.
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "teste-docx-"));
	try {
		const txt = path.join(dir, "amostra.txt");
		await fs.writeFile(txt, "Freevertio\nTrabalho Individual II\n");

		const { execFile } = await import("node:child_process");
		const { promisify } = await import("node:util");
		await promisify(execFile)(
			"soffice",
			["--headless", "--norestore", "--convert-to", "docx", "--outdir", dir, txt],
			{ timeout: 90_000 },
		);

		const docx = await fs.readFile(path.join(dir, "amostra.docx"));
		assert.equal(detectarPorAssinatura(docx), "zip", "um DOCX e um ZIP por dentro");

		const pdf = await converter({ buffer: docx, de: "docx", para: "pdf" });

		assert.equal(pdf.formato, "pdf");
		assert.equal(detectarPorAssinatura(pdf.buffer), "pdf");
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

/* --- limpeza e fila ------------------------------------------------- */

test("a conversao nao deixa diretorio temporario para tras", async (t) => {
	if (!ferramentas.has("pdftoppm")) return t.skip("pdftoppm nao instalado");

	const contar = async () =>
		(await fs.readdir(os.tmpdir())).filter((n) => n.startsWith("freevertio-")).length;

	const antes = await contar();

	await converter({ buffer: PDF_AMOSTRA, de: "pdf", para: "png" });
	// Uma que falha: o finally precisa limpar tambem neste caminho.
	await converter({ buffer: Buffer.from("%PDF-1.4\nlixo"), de: "pdf", para: "png" }).catch(
		() => {},
	);

	assert.equal(await contar(), antes, "sobraram diretorios temporarios");
});

test("a fila volta ao repouso depois das conversoes", () => {
	assert.equal(filaConversao.estado().emExecucao, 0);
	assert.equal(filaConversao.estado().aguardando, 0);
});
