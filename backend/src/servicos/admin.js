/**
 * Regra de negocio da area administrativa.
 *
 * As consultas aqui NAO filtram por dono - e essa a diferenca em relacao
 * a servicos/biblioteca.js. Por isso toda rota que chega neste modulo
 * passa antes por exigirLogin + exigirPerfil("admin").
 */

import { erros } from "../util/erros.js";
import { validarIdentificador } from "../util/validacao.js";
import { verificarAlteracaoDeConta } from "../util/regras.js";
import * as usuarioRepo from "../dados/usuario-repo.js";
import * as conversaoRepo from "../dados/conversao-repo.js";
import * as logRepo from "../dados/log-repo.js";
import * as armazenamento from "./armazenamento.js";
import { filaConversao } from "./conversao.js";
import { itemPublico } from "./biblioteca.js";

const NIVEIS = new Set(["info", "aviso", "erro"]);

function paginar({ pagina = 1, porPagina = 50 } = {}, maximo = 200) {
	const limite = Math.min(Math.max(Number(porPagina) || 50, 1), maximo);
	const paginaAtual = Math.max(Number(pagina) || 1, 1);
	return { limite, deslocamento: (paginaAtual - 1) * limite, paginaAtual };
}

/* ---------------------------------------------------------------------
 *  Contas
 * ------------------------------------------------------------------- */

export async function listarUsuarios(opcoes) {
	const { limite, deslocamento, paginaAtual } = paginar(opcoes);

	const [linhas, total] = await Promise.all([
		usuarioRepo.listar({ limite, deslocamento }),
		usuarioRepo.contar(),
	]);

	return {
		usuarios: linhas.map((u) => ({
			id: u.id,
			nome: u.nome,
			email: u.email,
			perfil: u.perfil,
			ativo: u.ativo,
			criadoEm: u.criado_em,
			totalConversoes: u.total_conversoes,
		})),
		paginacao: {
			pagina: paginaAtual,
			porPagina: limite,
			total,
			totalPaginas: Math.max(Math.ceil(total / limite), 1),
		},
	};
}

/**
 * Ativa ou desativa uma conta.
 *
 * Desativar, e nao apagar: a conta some do uso mas o historico de
 * conversoes e os registros de log continuam de pe. Apagar dispararia o
 * ON DELETE CASCADE e levaria a biblioteca inteira junto.
 */
export async function definirContaAtiva({ adminId, idBruto, ativo }) {
	const alvoId = validarIdentificador(idBruto);

	if (typeof ativo !== "boolean") {
		throw erros.entradaInvalida('O campo "ativo" deve ser true ou false.', {
			campo: "ativo",
		});
	}

	verificarAlteracaoDeConta({ adminId, alvoId, ativo });

	const usuario = await usuarioRepo.definirAtivo(alvoId, ativo);
	if (!usuario) throw erros.naoEncontrado("A conta");

	return {
		id: usuario.id,
		nome: usuario.nome,
		email: usuario.email,
		perfil: usuario.perfil,
		ativo: usuario.ativo,
	};
}

/* ---------------------------------------------------------------------
 *  Biblioteca de todos os usuarios
 * ------------------------------------------------------------------- */

export async function listarTodasConversoes(opcoes) {
	const { limite, deslocamento, paginaAtual } = paginar(opcoes);
	const linhas = await conversaoRepo.listarTodas({ limite, deslocamento });

	return {
		itens: linhas.map((c) => ({
			id: c.id,
			nome: c.nome_original,
			formatoOrigem: c.formato_origem,
			formatoDestino: c.formato_destino,
			origemConversao: c.origem_conversao,
			tamanhoBytes: Number(c.tamanho_bytes),
			criadoEm: c.criado_em,
			usuario: { id: c.usuario_id, email: c.usuario_email },
		})),
		paginacao: { pagina: paginaAtual, porPagina: limite },
	};
}

/** Apaga item de qualquer usuario. Mesma ordem do caminho comum: linha
 *  primeiro, arquivo depois. */
export async function apagarConversao(idBruto) {
	const id = validarIdentificador(idBruto);

	const linha = await conversaoRepo.apagarQualquer(id);
	if (!linha) throw erros.naoEncontrado("O arquivo");

	await armazenamento.remover(linha.nome_armazenado, linha.formato_destino);
	return itemPublico(linha);
}

/* ---------------------------------------------------------------------
 *  Logs e estatisticas
 * ------------------------------------------------------------------- */

export async function listarLogs({ nivel = null, ...opcoes } = {}) {
	if (nivel !== null && nivel !== undefined && !NIVEIS.has(nivel)) {
		throw erros.entradaInvalida('O filtro "nivel" deve ser info, aviso ou erro.', {
			campo: "nivel",
		});
	}

	const { limite, deslocamento, paginaAtual } = paginar(opcoes, 500);
	const linhas = await logRepo.listar({
		limite,
		deslocamento,
		nivel: nivel ?? null,
	});

	return {
		logs: linhas.map((l) => ({
			id: Number(l.id),
			ocorridoEm: l.ocorrido_em,
			nivel: l.nivel,
			evento: l.evento,
			usuario: l.usuario_id ? { id: l.usuario_id, email: l.usuario_email } : null,
			ip: l.ip,
			detalhe: l.detalhe,
		})),
		paginacao: { pagina: paginaAtual, porPagina: limite },
	};
}

export async function estatisticas({ desdeHoras = 24 } = {}) {
	const horas = Math.min(Math.max(Number(desdeHoras) || 24, 1), 24 * 30);

	const [totalUsuarios, conversoes, bytesEmDisco, eventos] = await Promise.all([
		usuarioRepo.contar(),
		conversaoRepo.estatisticas(),
		armazenamento.espacoOcupadoBytes(),
		logRepo.contarPorEvento({ desdeHoras: horas }),
	]);

	return {
		usuarios: { total: totalUsuarios },
		conversoes: {
			total: conversoes.total,
			bytesTotais: Number(conversoes.bytes_totais),
			convertidasLocal: conversoes.convertidas_local,
			convertidasServidor: conversoes.convertidas_servidor,
		},
		armazenamento: {
			bytesEmDisco,

			// A diferenca entre o somatorio do banco e o que ha em disco
			// revela arquivos orfaos - resultado de uma remocao que
			// falhou depois de a linha ja ter sido apagada.
			diferencaBytes: bytesEmDisco - Number(conversoes.bytes_totais),
		},
		fila: filaConversao.estado(),
		eventos: { desdeHoras: horas, porEvento: eventos },
	};
}
