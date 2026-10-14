/**
 * Regra de negocio da biblioteca.
 *
 * Coordena banco e disco, que e o ponto delicado: sao dois armazenamentos
 * que precisam concordar, e o PostgreSQL nao pode fazer rollback de um
 * fs.unlink. A ordem das operacoes em cada funcao resolve isso, e esta
 * comentada caso a caso.
 *
 * Nao conhece req nem res.
 */

import { erros } from "../util/erros.js";
import { validarIdentificador } from "../util/validacao.js";
import { validarConteudo, sanitizarNomeArquivo, extensaoDe, FORMATOS } from "../util/formatos.js";
import * as conversaoRepo from "../dados/conversao-repo.js";
import * as armazenamento from "./armazenamento.js";
import { escrever } from "../util/logger.js";

const ORIGENS = new Set(["local", "servidor"]);

/** Forma publica de um item. Nunca expoe nome_armazenado: o nome do
 *  arquivo em disco nao e assunto do cliente. */
export function itemPublico(linha) {
	return {
		id: linha.id,
		nome: linha.nome_original,
		formatoOrigem: linha.formato_origem,
		formatoDestino: linha.formato_destino,
		origemConversao: linha.origem_conversao,
		tamanhoBytes: Number(linha.tamanho_bytes),
		criadoEm: linha.criado_em,
		expiraEm: linha.expira_em,
	};
}

/**
 * Guarda um arquivo ja convertido.
 *
 * Esta e a rota de upload CRU: o servidor nunca viu este arquivo, ele
 * chegou pronto do navegador. Por isso a validacao aqui precisa ser tao
 * rigorosa quanto a da conversao - e o caminho mais facil de esquecer.
 */
export async function guardar({
	usuarioId,
	buffer,
	nomeArquivo,
	formatoOrigem,
	formatoDestino,
	origemConversao,
}) {
	if (!buffer || buffer.length === 0) {
		throw erros.entradaInvalida("Nenhum arquivo foi enviado.");
	}

	if (!ORIGENS.has(origemConversao)) {
		throw erros.entradaInvalida('O campo "origemConversao" deve ser "local" ou "servidor".');
	}

	const origem = String(formatoOrigem ?? "").toLowerCase();
	const destino = String(formatoDestino ?? "").toLowerCase();

	if (!Object.hasOwn(FORMATOS, origem) || !Object.hasOwn(FORMATOS, destino)) {
		throw erros.formatoNaoSuportado("Formato de origem ou de destino nao aceito.");
	}
	// A constraint conversao_formatos_diferentes exige isso no banco;
	// verificar aqui produz mensagem util em vez de erro de constraint.
	if (origem === destino) {
		throw erros.entradaInvalida("O formato de destino deve ser diferente do de origem.");
	}

	// O servidor decide o que o arquivo e, olhando o conteudo. O que o
	// cliente declarou so vale depois de conferido.
	const tipoMime = validarConteudo(buffer, destino);

	const nome = garantirExtensao(sanitizarNomeArquivo(nomeArquivo), destino);

	// Grava o arquivo ANTES da linha. Se o INSERT falhar depois, sobra um
	// arquivo orfao - invisivel e removivel por limpeza. Na ordem
	// inversa, a linha existiria apontando para um arquivo que nunca foi
	// escrito, e o usuario veria um item que nao baixa.
	const nomeArmazenado = await armazenamento.gravar(buffer, destino);

	try {
		const linha = await conversaoRepo.criar({
			usuarioId,
			nomeOriginal: nome,
			formatoOrigem: origem,
			formatoDestino: destino,
			origemConversao,
			tipoMime,
			tamanhoBytes: buffer.length,
			nomeArmazenado,
		});
		return itemPublico(linha);
	} catch (erro) {
		// Desfaz a gravacao para nao deixar o orfao de proposito.
		await armazenamento.remover(nomeArmazenado, destino);
		throw erro;
	}
}

function garantirExtensao(nome, formato) {
	return extensaoDe(nome) === formato ? nome : `${nome}.${formato}`;
}

export async function listar(usuarioId, { pagina = 1, porPagina = 20 } = {}) {
	const limite = Math.min(Math.max(Number(porPagina) || 20, 1), 100);
	const paginaAtual = Math.max(Number(pagina) || 1, 1);
	const deslocamento = (paginaAtual - 1) * limite;

	const [linhas, total] = await Promise.all([
		conversaoRepo.listarDoUsuario(usuarioId, { limite, deslocamento }),
		conversaoRepo.contarDoUsuario(usuarioId),
	]);

	return {
		itens: linhas.map(itemPublico),
		paginacao: {
			pagina: paginaAtual,
			porPagina: limite,
			total,
			totalPaginas: Math.max(Math.ceil(total / limite), 1),
		},
	};
}

/**
 * Carrega um item para download.
 *
 * Devolve 404 quando o item nao existe E quando pertence a outra pessoa.
 * Responder 403 no segundo caso confirmaria a existencia do item para
 * quem esta sondando identificadores.
 */
export async function obterParaDownload(idBruto, usuarioId) {
	const id = validarIdentificador(idBruto);
	const linha = await conversaoRepo.buscarDoUsuario(id, usuarioId);

	if (!linha) throw erros.naoEncontrado("O arquivo");

	// Linha sem arquivo: estado inconsistente, nao culpa do usuario.
	// Registrado para investigacao e devolvido como ausente.
	if (!(await armazenamento.existe(linha.nome_armazenado, linha.formato_destino))) {
		escrever("erro", "arquivo_ausente_no_disco", {
			usuarioId,
			detalhe: `conversao id=${id} nome_armazenado=${linha.nome_armazenado}`,
		});
		throw erros.naoEncontrado("O arquivo");
	}

	const conteudo = await armazenamento.ler(linha.nome_armazenado, linha.formato_destino);
	return { linha, conteudo };
}

export async function renomear(idBruto, usuarioId, nomeNovo) {
	const id = validarIdentificador(idBruto);

	const nome = sanitizarNomeArquivo(nomeNovo);
	if (nome === "arquivo" && String(nomeNovo ?? "").trim() === "") {
		throw erros.entradaInvalida("Informe o novo nome do arquivo.");
	}

	const atual = await conversaoRepo.buscarDoUsuario(id, usuarioId);
	if (!atual) throw erros.naoEncontrado("O arquivo");

	const linha = await conversaoRepo.renomear(
		id,
		usuarioId,
		garantirExtensao(nome, atual.formato_destino),
	);
	return itemPublico(linha);
}

/**
 * Apaga item e arquivo.
 *
 * Aqui a ordem se inverte em relacao ao guardar: a LINHA sai primeiro.
 * Se a remocao do arquivo falhar, sobra um orfao em disco, que ninguem
 * ve e uma limpeza resolve. Na ordem inversa, uma falha ao apagar a
 * linha deixaria um item visivel que nao baixa mais - pior para o
 * usuario e irrecuperavel sem intervencao.
 */
export async function apagar(idBruto, usuarioId) {
	const id = validarIdentificador(idBruto);

	const linha = await conversaoRepo.apagar(id, usuarioId);
	if (!linha) throw erros.naoEncontrado("O arquivo");

	const removido = await armazenamento.remover(linha.nome_armazenado, linha.formato_destino);

	if (!removido) {
		escrever("aviso", "arquivo_orfao", {
			usuarioId,
			detalhe: `linha apagada mas arquivo ${linha.nome_armazenado}.${linha.formato_destino} permaneceu`,
		});
	}

	return itemPublico(linha);
}
