/**
 * Acesso a tabela log_evento.
 *
 * Como todo modulo de dados/: so SQL, sempre parametrizado, sem regra de
 * negocio e sem conhecer HTTP.
 */

import { pool } from "./pool.js";

/**
 * Grava um evento. Os parametros vao por $1..$5 - o driver envia valores
 * e comando por canais separados, entao nenhum conteudo de usuario pode
 * virar SQL.
 */
export async function inserir({ nivel, evento, usuarioId = null, ip = null, detalhe = null }) {
	await pool.query(
		`INSERT INTO log_evento (nivel, evento, usuario_id, ip, detalhe)
		 VALUES ($1, $2, $3, $4, $5)`,
		[nivel, evento, usuarioId, ip, detalhe],
	);
}

/**
 * Listagem paginada, usada pela area administrativa.
 * O filtro por nivel e opcional: quando nulo, a condicao se anula.
 */
export async function listar({ limite = 100, deslocamento = 0, nivel = null } = {}) {
	const { rows } = await pool.query(
		`SELECT l.id, l.ocorrido_em, l.nivel, l.evento, l.usuario_id,
		        u.email AS usuario_email, l.ip, l.detalhe
		   FROM log_evento l
		   LEFT JOIN usuario u ON u.id = l.usuario_id
		  WHERE ($3::varchar IS NULL OR l.nivel = $3)
		  ORDER BY l.ocorrido_em DESC
		  LIMIT $1 OFFSET $2`,
		[limite, deslocamento, nivel],
	);
	return rows;
}

/**
 * Contagem por evento numa janela de tempo, para as estatisticas da area
 * administrativa.
 */
export async function contarPorEvento({ desdeHoras = 24 } = {}) {
	const { rows } = await pool.query(
		`SELECT evento, nivel, count(*)::int AS total
		   FROM log_evento
		  WHERE ocorrido_em > now() - ($1 || ' hours')::interval
		  GROUP BY evento, nivel
		  ORDER BY total DESC`,
		[desdeHoras],
	);
	return rows;
}
