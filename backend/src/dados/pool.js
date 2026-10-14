/**
 * Conexao com o PostgreSQL.
 *
 * Um pool unico para toda a aplicacao. Abrir conexao por requisicao
 * custaria mais que a propria consulta; o pool reaproveita um conjunto
 * pequeno e as empresta conforme a demanda.
 *
 * Este e o unico modulo que instancia o driver. Os repositorios em
 * dados/ importam o pool daqui; nenhuma outra camada o importa.
 */

import pg from "pg";
import { config } from "../config/index.js";
import { escrever } from "../util/logger.js";

export const pool = new pg.Pool({
	host: config.banco.host,
	port: config.banco.port,
	database: config.banco.database,
	user: config.banco.user,
	password: config.banco.password,

	max: 10, // conexoes simultaneas no maximo
	idleTimeoutMillis: 30_000, // devolve ao SO conexoes ociosas
	connectionTimeoutMillis: 5_000, // falha rapido se o banco nao responde
});

/**
 * Erro em conexao OCIOSA do pool. Sem este tratador, o driver emite um
 * evento 'error' sem ouvinte e o Node derruba o processo inteiro - um
 * reinicio do PostgreSQL mataria a aplicacao.
 */
pool.on("error", (erro) => {
	escrever("erro", "pool_conexao_ociosa", { detalhe: erro.message });
});

/**
 * Verifica a conexao na subida da aplicacao. Melhor descobrir que a
 * senha esta errada agora do que na primeira tentativa de login.
 */
export async function verificarConexao() {
	const { rows } = await pool.query("SELECT current_database() AS banco, version() AS versao");
	return rows[0];
}

export async function encerrarPool() {
	await pool.end();
}
