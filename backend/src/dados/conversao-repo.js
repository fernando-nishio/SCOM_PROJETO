/**
 * Acesso a tabela conversao.
 *
 * O ponto mais importante deste arquivo: as consultas de um item
 * individual levam usuario_id na clausula WHERE. Nao como verificacao
 * extra depois de buscar - como CONDICAO DE BUSCA.
 *
 *     -- vulneravel: autentica, mas nao autoriza
 *     SELECT * FROM conversao WHERE id = $1
 *
 *     -- correto: o dono faz parte da pergunta
 *     SELECT * FROM conversao WHERE id = $1 AND usuario_id = $2
 *
 * Com a segunda forma, pedir o item de outra pessoa devolve zero linhas,
 * e a camada acima responde 404 - que nao confirma nem desmente a
 * existencia do item. Ver docs/permissoes.md.
 */

import { pool } from "./pool.js";

const CAMPOS = `
	id, usuario_id, nome_original, formato_origem, formato_destino,
	origem_conversao, tipo_mime, tamanho_bytes, nome_armazenado,
	criado_em, expira_em
`;

export async function criar({
	usuarioId,
	nomeOriginal,
	formatoOrigem,
	formatoDestino,
	origemConversao,
	tipoMime,
	tamanhoBytes,
	nomeArmazenado,
}) {
	const { rows } = await pool.query(
		`INSERT INTO conversao
		   (usuario_id, nome_original, formato_origem, formato_destino,
		    origem_conversao, tipo_mime, tamanho_bytes, nome_armazenado)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING ${CAMPOS}`,
		[
			usuarioId,
			nomeOriginal,
			formatoOrigem,
			formatoDestino,
			origemConversao,
			tipoMime,
			tamanhoBytes,
			nomeArmazenado,
		],
	);
	return rows[0];
}

/**
 * Biblioteca de um usuario, paginada.
 * Usa o indice idx_conversao_usuario_data, que cobre o filtro e a
 * ordenacao de uma vez so.
 */
export async function listarDoUsuario(usuarioId, { limite = 20, deslocamento = 0 } = {}) {
	const { rows } = await pool.query(
		`SELECT ${CAMPOS}
		   FROM conversao
		  WHERE usuario_id = $1
		  ORDER BY criado_em DESC
		  LIMIT $2 OFFSET $3`,
		[usuarioId, limite, deslocamento],
	);
	return rows;
}

export async function contarDoUsuario(usuarioId) {
	const { rows } = await pool.query(
		"SELECT count(*)::int AS total FROM conversao WHERE usuario_id = $1",
		[usuarioId],
	);
	return rows[0].total;
}

/** Um item, SE pertencer ao usuario. Caso contrario, null. */
export async function buscarDoUsuario(id, usuarioId) {
	const { rows } = await pool.query(
		`SELECT ${CAMPOS} FROM conversao WHERE id = $1 AND usuario_id = $2`,
		[id, usuarioId],
	);
	return rows[0] ?? null;
}

export async function renomear(id, usuarioId, nomeOriginal) {
	const { rows } = await pool.query(
		`UPDATE conversao
		    SET nome_original = $3
		  WHERE id = $1 AND usuario_id = $2
		  RETURNING ${CAMPOS}`,
		[id, usuarioId, nomeOriginal],
	);
	return rows[0] ?? null;
}

/**
 * Apaga a linha e devolve o registro apagado, para que a camada de
 * servico saiba qual arquivo remover do disco. Devolver em vez de exigir
 * uma busca previa evita a janela entre consultar e apagar.
 */
export async function apagar(id, usuarioId) {
	const { rows } = await pool.query(
		`DELETE FROM conversao WHERE id = $1 AND usuario_id = $2 RETURNING ${CAMPOS}`,
		[id, usuarioId],
	);
	return rows[0] ?? null;
}

/* ---------------------------------------------------------------------
 *  Area administrativa
 *
 *  Consultas SEM o filtro de dono. Separadas de proposito, e nao feitas
 *  com uma condicao opcional nas funcoes acima: um descuido numa
 *  condicional transformaria a consulta do usuario comum em consulta
 *  irrestrita.
 * ------------------------------------------------------------------- */

export async function listarTodas({ limite = 50, deslocamento = 0 } = {}) {
	const { rows } = await pool.query(
		`SELECT c.id, c.nome_original, c.formato_origem, c.formato_destino,
		        c.origem_conversao, c.tamanho_bytes, c.criado_em,
		        u.id AS usuario_id, u.email AS usuario_email
		   FROM conversao c
		   JOIN usuario u ON u.id = c.usuario_id
		  ORDER BY c.criado_em DESC
		  LIMIT $1 OFFSET $2`,
		[limite, deslocamento],
	);
	return rows;
}

/**
 * Apaga qualquer item, SEM o filtro de dono. Exclusiva da area
 * administrativa, e separada de apagar() de proposito: a diferenca
 * entre as duas nao pode depender de um parametro opcional que alguem
 * esqueca de passar.
 */
export async function apagarQualquer(id) {
	const { rows } = await pool.query(
		`DELETE FROM conversao WHERE id = $1 RETURNING ${CAMPOS}`,
		[id],
	);
	return rows[0] ?? null;
}

export async function estatisticas() {
	const { rows } = await pool.query(
		`SELECT count(*)::int                      AS total,
		        coalesce(sum(tamanho_bytes), 0)::bigint AS bytes_totais,
		        count(*) FILTER (WHERE origem_conversao = 'local')::int    AS convertidas_local,
		        count(*) FILTER (WHERE origem_conversao = 'servidor')::int AS convertidas_servidor
		   FROM conversao`,
	);
	return rows[0];
}

/** Itens vencidos, para a rotina de retencao. */
export async function listarVencidas() {
	const { rows } = await pool.query(
		`SELECT ${CAMPOS} FROM conversao
		  WHERE expira_em IS NOT NULL AND expira_em <= now()`,
	);
	return rows;
}
