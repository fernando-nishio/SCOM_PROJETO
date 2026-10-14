/**
 * Identificacao de formato de arquivo e saneamento de nome.
 *
 * Modulo puro: sem banco, sem HTTP, sem disco. Testado em
 * testes/formatos.test.js.
 *
 * A ideia central deste arquivo: a EXTENSAO do nome de um arquivo e um
 * palpite do cliente, nao um fato. Quem decide o que o arquivo e sao os
 * primeiros bytes do conteudo - a "assinatura" ou magic number. No
 * navegador essa diferenca era inofensiva; no servidor, nao.
 */

import { erros } from "./erros.js";

/* ---------------------------------------------------------------------
 *  Assinaturas
 *
 *  Cada entrada diz: em que posicao olhar e que bytes esperar. A
 *  verificacao e feita na ordem da lista.
 * ------------------------------------------------------------------- */
const ASSINATURAS = [
	{ formato: "png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
	{ formato: "jpg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
	{ formato: "gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
	{ formato: "pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF

	// ZIP. Importa porque DOCX, XLSX e ODT sao arquivos ZIP por dentro -
	// a assinatura sozinha nao distingue um do outro.
	{ formato: "zip", offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
];

/**
 * WEBP precisa de dois trechos: "RIFF" no inicio e "WEBP" no byte 8, com
 * o tamanho do arquivo entre eles. Verificar so o "RIFF" aceitaria WAV e
 * AVI, que usam o mesmo contêiner.
 */
function ehWebp(buffer) {
	return (
		buffer.length >= 12 &&
		buffer.toString("ascii", 0, 4) === "RIFF" &&
		buffer.toString("ascii", 8, 12) === "WEBP"
	);
}

/**
 * AVIF usa o contêiner ISOBMFF, o mesmo do MP4 e do HEIC: "ftyp" no byte
 * 4 e a "marca" do formato logo em seguida. Verificar so o "ftyp"
 * aceitaria video.
 */
function ehAvif(buffer) {
	if (buffer.length < 12) return false;
	if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;

	const marca = buffer.toString("ascii", 8, 12);
	return marca === "avif" || marca === "avis";
}

/**
 * TIFF tem duas assinaturas, uma para cada ordem de bytes: "II*\0" em
 * little-endian (Intel) e "MM\0*" em big-endian (Motorola).
 */
function ehTiff(buffer) {
	if (buffer.length < 4) return false;

	const li = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
	const bi = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
	return li || bi;
}

/**
 * Identifica o formato pelo conteudo.
 * @returns {string|null} formato, ou null se nao houver assinatura conhecida
 */
export function detectarPorAssinatura(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

	// Os que precisam de logica propria vem antes da tabela.
	if (ehWebp(buffer)) return "webp";
	if (ehAvif(buffer)) return "avif";
	if (ehTiff(buffer)) return "tiff";

	for (const { formato, offset, bytes } of ASSINATURAS) {
		if (buffer.length < offset + bytes.length) continue;

		const confere = bytes.every((b, i) => buffer[offset + i] === b);
		if (confere) return formato;
	}

	return null;
}

/**
 * Formatos de texto nao tem assinatura: um CSV e um TXT sao bytes de
 * texto e nada mais. A verificacao possivel e outra - o conteudo decodifica
 * como UTF-8 valido?
 *
 * O truque: decodificar e recodificar. Se os bytes voltarem iguais, era
 * UTF-8 valido; se o decodificador tiver substituido algo pelo caractere
 * de substituicao (U+FFFD), os tamanhos divergem.
 */
export function ehTextoUtf8(buffer) {
	if (!Buffer.isBuffer(buffer)) return false;
	if (buffer.length === 0) return true;

	// Byte nulo nao aparece em texto, mas e comum em binario.
	if (buffer.includes(0x00)) return false;

	const texto = buffer.toString("utf8");
	return Buffer.byteLength(texto, "utf8") === buffer.length;
}

/* ---------------------------------------------------------------------
 *  Formatos aceitos na biblioteca
 * ------------------------------------------------------------------- */

export const FORMATOS = Object.freeze({
	// --- imagens -----------------------------------------------------
	jpg: { mime: "image/jpeg", binario: true, assinatura: "jpg" },
	jpeg: { mime: "image/jpeg", binario: true, assinatura: "jpg" },
	png: { mime: "image/png", binario: true, assinatura: "png" },
	webp: { mime: "image/webp", binario: true, assinatura: "webp" },
	gif: { mime: "image/gif", binario: true, assinatura: "gif" },
	avif: { mime: "image/avif", binario: true, assinatura: "avif" },
	tiff: { mime: "image/tiff", binario: true, assinatura: "tiff" },

	// --- documentos --------------------------------------------------
	pdf: { mime: "application/pdf", binario: true, assinatura: "pdf" },

	// DOCX, XLSX, PPTX e ODT sao arquivos ZIP por dentro, e a assinatura
	// e a mesma para todos. Ou seja: o servidor confirma que o conteudo
	// E um ZIP, mas nao consegue distinguir um do outro so pelos
	// primeiros bytes.
	//
	// A escolha aqui e deliberada: aceitar o tipo declarado pelo cliente
	// entre os quatro, e deixar o conversor decidir. Um DOCX declarado
	// como XLSX falha no LibreOffice e vira 422 FALHA_CONVERSAO - erro
	// claro, sem risco. Distinguir de verdade exigiria abrir o ZIP e ler
	// o manifesto interno, o que significa descompactar conteudo nao
	// confiavel antes de valida-lo.
	docx: {
		mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		binario: true,
		assinatura: "zip",
	},
	xlsx: {
		mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		binario: true,
		assinatura: "zip",
	},
	pptx: {
		mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		binario: true,
		assinatura: "zip",
	},
	odt: {
		mime: "application/vnd.oasis.opendocument.text",
		binario: true,
		assinatura: "zip",
	},
	ods: {
		mime: "application/vnd.oasis.opendocument.spreadsheet",
		binario: true,
		assinatura: "zip",
	},

	// --- texto -------------------------------------------------------
	csv: { mime: "text/csv", binario: false },
	json: { mime: "application/json", binario: false },
	txt: { mime: "text/plain", binario: false },
});

/**
 * Confere se o CONTEUDO corresponde ao formato declarado pelo cliente.
 *
 * Esta funcao e a fronteira entre "o cliente disse" e "o servidor
 * verificou". Sem ela, bastaria renomear um executavel para .png.
 */
export function validarConteudo(buffer, formatoDeclarado) {
	const formato = FORMATOS[formatoDeclarado];

	if (!formato) {
		throw erros.formatoNaoSuportado(`O formato ".${formatoDeclarado}" nao e aceito.`);
	}

	if (buffer.length === 0) {
		throw erros.entradaInvalida("O arquivo esta vazio.");
	}

	if (formato.binario) {
		const detectado = detectarPorAssinatura(buffer);
		if (detectado !== formato.assinatura) {
			throw erros.formatoNaoSuportado(
				`O conteudo do arquivo nao corresponde a um ${formatoDeclarado.toUpperCase()}.`,
			);
		}
		return formato.mime;
	}

	// Texto: precisa ser UTF-8 valido...
	if (!ehTextoUtf8(buffer)) {
		throw erros.formatoNaoSuportado(
			"O arquivo deveria ser texto, mas contem dados binarios.",
		);
	}

	// ...e, no caso do JSON, precisa realmente ser JSON.
	if (formatoDeclarado === "json") {
		try {
			JSON.parse(buffer.toString("utf8"));
		} catch {
			throw erros.formatoNaoSuportado("O arquivo nao e um JSON valido.");
		}
	}

	return formato.mime;
}

/* ---------------------------------------------------------------------
 *  Nomes de arquivo
 * ------------------------------------------------------------------- */

/** Extensao em minusculas, sem o ponto. Vazio quando nao houver. */
export function extensaoDe(nome) {
	const texto = String(nome ?? "");
	const ponto = texto.lastIndexOf(".");

	if (ponto <= 0 || ponto === texto.length - 1) return "";
	return texto.slice(ponto + 1).toLowerCase();
}

/**
 * Limpa um nome de arquivo vindo do cliente.
 *
 * O nome NUNCA e usado como caminho em disco - para isso existe o UUID.
 * Mas ele e guardado no banco, exibido na tela e devolvido no cabecalho
 * Content-Disposition, e cada um desses usos tem um risco proprio:
 *
 *   - separadores de caminho e ".." permitiriam travessia de diretorio
 *     caso alguem venha a usar o nome em disco por engano;
 *   - aspas e quebras de linha quebram o Content-Disposition e permitem
 *     injetar cabecalhos HTTP;
 *   - caracteres de controle sujam log e terminal.
 */
export function sanitizarNomeArquivo(nome) {
	let limpo = String(nome ?? "").trim();

	// Fica so com o ultimo componente: "../../etc/passwd" vira "passwd".
	limpo = limpo.split(/[/\\]/).pop() ?? "";

	// Remove caracteres de controle, aspas e os proibidos em sistemas de
	// arquivos comuns.
	// eslint-disable-next-line no-control-regex
	limpo = limpo.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "");

	// Pontos no inicio escondem o arquivo em sistemas Unix.
	limpo = limpo.replace(/^\.+/, "");

	limpo = limpo.trim();

	if (limpo.length === 0) return "arquivo";
	return limpo.length > 200 ? limpo.slice(0, 200) : limpo;
}

/**
 * Versao do nome segura para o parametro filename do Content-Disposition,
 * que so aceita ASCII. O nome completo vai no filename*, em UTF-8.
 */
export function nomeAscii(nome) {
	// A flag u faz o regex contar por SIMBOLO e nao por unidade UTF-16.
	// Sem ela, um emoji (que ocupa duas unidades) viraria dois
	// underscores em vez de um.
	const limpo = sanitizarNomeArquivo(nome)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "") // tira acentos
		.replace(/[^\x20-\x7e]/gu, "_"); // o que sobrou de nao-ASCII

	return limpo.length > 0 ? limpo : "arquivo";
}
