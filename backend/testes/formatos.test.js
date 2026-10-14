/**
 * Testes da identificacao de formato e do saneamento de nomes.
 *
 * Esta e a camada que decide se um arquivo e mesmo o que o cliente
 * declarou. Varios casos abaixo sao tentativas de ataque documentadas:
 * executavel disfarcado de imagem, travessia de diretorio pelo nome,
 * injecao de cabecalho HTTP.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
	detectarPorAssinatura,
	ehTextoUtf8,
	validarConteudo,
	extensaoDe,
	sanitizarNomeArquivo,
	nomeAscii,
} from "../src/util/formatos.js";

/* --- amostras minimas, com a assinatura real de cada formato -------- */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1");
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

function montarWebp() {
	const b = Buffer.alloc(16);
	b.write("RIFF", 0, "ascii");
	b.writeUInt32LE(8, 4);
	b.write("WEBP", 8, "ascii");
	return b;
}

// Mesmo contêiner RIFF do WEBP, mas e um WAV: a verificacao nao pode
// confundir os dois.
function montarWav() {
	const b = Buffer.alloc(16);
	b.write("RIFF", 0, "ascii");
	b.writeUInt32LE(8, 4);
	b.write("WAVE", 8, "ascii");
	return b;
}

/* --- deteccao por assinatura --------------------------------------- */

test("detectarPorAssinatura reconhece os formatos binarios", () => {
	assert.equal(detectarPorAssinatura(PNG), "png");
	assert.equal(detectarPorAssinatura(JPG), "jpg");
	assert.equal(detectarPorAssinatura(PDF), "pdf");
	assert.equal(detectarPorAssinatura(ZIP), "zip");
	assert.equal(detectarPorAssinatura(montarWebp()), "webp");
});

test("detectarPorAssinatura distingue WEBP de outros contêineres RIFF", () => {
	assert.equal(detectarPorAssinatura(montarWav()), null);
});

test("detectarPorAssinatura devolve null para conteudo sem assinatura", () => {
	assert.equal(detectarPorAssinatura(Buffer.from("nome,idade\nana,30")), null);
	assert.equal(detectarPorAssinatura(Buffer.alloc(0)), null);
	assert.equal(detectarPorAssinatura("nao e buffer"), null);
});

/* --- texto UTF-8 ---------------------------------------------------- */

test("ehTextoUtf8 aceita texto com acentos e emoji", () => {
	assert.ok(ehTextoUtf8(Buffer.from("conversão de arquivos 🔐", "utf8")));
});

test("ehTextoUtf8 rejeita bytes invalidos e byte nulo", () => {
	assert.ok(!ehTextoUtf8(Buffer.from([0xff, 0xfe, 0xfd])));
	assert.ok(!ehTextoUtf8(Buffer.from([0x61, 0x00, 0x62])));
	assert.ok(!ehTextoUtf8(PNG));
});

/* --- validarConteudo: o que o cliente diz x o que o arquivo e ------- */

test("validarConteudo aceita arquivo cujo conteudo bate com o declarado", () => {
	assert.equal(validarConteudo(PNG, "png"), "image/png");
	assert.equal(validarConteudo(JPG, "jpg"), "image/jpeg");
	assert.equal(validarConteudo(PDF, "pdf"), "application/pdf");
	assert.equal(validarConteudo(Buffer.from("a,b\n1,2"), "csv"), "text/csv");
	assert.equal(validarConteudo(Buffer.from('{"a":1}'), "json"), "application/json");
});

test("validarConteudo recusa binario disfarcado de imagem", () => {
	// Um ELF (executavel Linux) com o nome trocado para .png.
	const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
	assert.throws(() => validarConteudo(elf, "png"), /nao corresponde/);
});

test("validarConteudo recusa um PNG declarado como JPG", () => {
	assert.throws(() => validarConteudo(PNG, "jpg"), /nao corresponde/);
});

test("validarConteudo recusa binario declarado como texto", () => {
	assert.throws(() => validarConteudo(PNG, "csv"), /dados binarios/);
});

test("validarConteudo recusa JSON malformado", () => {
	assert.throws(() => validarConteudo(Buffer.from("{isto nao e json"), "json"), /JSON valido/);
});

test("validarConteudo recusa formato desconhecido e arquivo vazio", () => {
	assert.throws(() => validarConteudo(PNG, "exe"), /nao e aceito/);
	assert.throws(() => validarConteudo(Buffer.alloc(0), "png"), /vazio/);
});

/* --- extensao ------------------------------------------------------- */

test("extensaoDe devolve a extensao em minusculas", () => {
	assert.equal(extensaoDe("foto.PNG"), "png");
	assert.equal(extensaoDe("arquivo.tar.gz"), "gz");
	assert.equal(extensaoDe("sem-extensao"), "");
	assert.equal(extensaoDe(".oculto"), "");
	assert.equal(extensaoDe("termina-com-ponto."), "");
});

/* --- saneamento de nome: vetores de ataque -------------------------- */

test("sanitizarNomeArquivo neutraliza travessia de diretorio", () => {
	assert.equal(sanitizarNomeArquivo("../../etc/passwd"), "passwd");
	assert.equal(sanitizarNomeArquivo("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe");
	assert.equal(sanitizarNomeArquivo("/etc/shadow"), "shadow");
});

test("sanitizarNomeArquivo impede injecao no cabecalho Content-Disposition", () => {
	const malicioso = 'arquivo.png"\r\nSet-Cookie: admin=1';
	const limpo = sanitizarNomeArquivo(malicioso);

	assert.ok(!limpo.includes('"'));
	assert.ok(!limpo.includes("\r"));
	assert.ok(!limpo.includes("\n"));
});

test("sanitizarNomeArquivo remove pontos iniciais e nunca devolve vazio", () => {
	assert.equal(sanitizarNomeArquivo("...bashrc"), "bashrc");
	assert.equal(sanitizarNomeArquivo(""), "arquivo");
	assert.equal(sanitizarNomeArquivo("   "), "arquivo");
	assert.equal(sanitizarNomeArquivo(null), "arquivo");
});

test("sanitizarNomeArquivo preserva nome legitimo com acento", () => {
	assert.equal(sanitizarNomeArquivo("  relatório final.pdf  "), "relatório final.pdf");
});

test("sanitizarNomeArquivo limita o tamanho", () => {
	assert.equal(sanitizarNomeArquivo("x".repeat(500)).length, 200);
});

test("nomeAscii remove acentos e caracteres fora do ASCII imprimivel", () => {
	assert.equal(nomeAscii("relatório final.pdf"), "relatorio final.pdf");

	// Um emoji vira UM underscore, nao dois: ele ocupa duas unidades
	// UTF-16, e so a flag u do regex o trata como simbolo unico.
	assert.equal(nomeAscii("conversão🔐.png"), "conversao_.png");

	// Tres ideogramas, tres underscores.
	assert.equal(nomeAscii("ação日本語.txt"), "acao___.txt");

	// O resultado e sempre ASCII imprimivel, que e o que o parametro
	// filename do Content-Disposition aceita.
	assert.ok(/^[\x20-\x7e]+$/.test(nomeAscii("ação日本語.txt")));
});
