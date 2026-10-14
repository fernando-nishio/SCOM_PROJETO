/**
 * Acesso a tabela usuario.
 *
 * Regra que vale para todo este diretorio: apenas SQL parametrizado,
 * sem regra de negocio, sem conhecer HTTP.
 *
 * A coluna senha_hash so sai do banco em buscarPorEmailParaLogin(). As
 * demais funcoes selecionam colunas nomeadas e nunca "SELECT *" - assim
 * o hash nao escapa por engano para um JSON de resposta.
 */

import { pool } from "./pool.js";

const CAMPOS_PUBLICOS = "id, nome, email, perfil, ativo, criado_em";

export async function criar({ nome, email, senhaHash, perfil = "usuario" }) {
	const { rows } = await pool.query(
		`INSERT INTO usuario (nome, email, senha_hash, perfil)
		 VALUES ($1, $2, $3, $4)
		 RETURNING ${CAMPOS_PUBLICOS}`,
		[nome, email, senhaHash, perfil],
	);
	return rows[0];
}

/**
 * Usada SOMENTE na verificacao de login: e a unica consulta que traz o
 * hash. Inclui contas inativas de proposito - quem decide o que fazer
 * com uma conta desativada e a camada de servico, nao esta.
 */
export async function buscarPorEmailParaLogin(email) {
	const { rows } = await pool.query(
		`SELECT id, nome, email, senha_hash, perfil, ativo
		   FROM usuario
		  WHERE email = $1`,
		[email],
	);
	return rows[0] ?? null;
}

/** Carregada a cada requisicao autenticada, pela chave primaria. */
export async function buscarPorId(id) {
	const { rows } = await pool.query(
		`SELECT ${CAMPOS_PUBLICOS} FROM usuario WHERE id = $1`,
		[id],
	);
	return rows[0] ?? null;
}

/**
 * Insere o usuario, ou redefine a senha se o e-mail ja existir.
 *
 * Usada SOMENTE pelo script de popular o banco em desenvolvimento
 * (scripts/seed.js), e e o que torna aquele script reexecutavel.
 *
 * Fica isolada das demais de proposito: nenhuma rota pode trocar a senha
 * de uma conta existente sem antes verificar a senha atual. Se esta
 * funcao for chamada de outro lugar, e defeito.
 */
export async function criarOuRedefinirSenha({ nome, email, senhaHash, perfil }) {
	const { rows } = await pool.query(
		`INSERT INTO usuario (nome, email, senha_hash, perfil)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (email) DO UPDATE
		    SET senha_hash = EXCLUDED.senha_hash,
		        nome       = EXCLUDED.nome,
		        perfil     = EXCLUDED.perfil,
		        ativo      = TRUE
		 RETURNING ${CAMPOS_PUBLICOS}`,
		[nome, email, senhaHash, perfil],
	);
	return rows[0];
}

export async function existeEmail(email) {
	const { rows } = await pool.query(
		"SELECT 1 FROM usuario WHERE email = $1 LIMIT 1",
		[email],
	);
	return rows.length > 0;
}

/* ---------------------------------------------------------------------
 * Area administrativa
 * ------------------------------------------------------------------- */

export async function listar({ limite = 50, deslocamento = 0 } = {}) {
	const { rows } = await pool.query(
		`SELECT u.id, u.nome, u.email, u.perfil, u.ativo, u.criado_em,
		        count(c.id)::int AS total_conversoes
		   FROM usuario u
		   LEFT JOIN conversao c ON c.usuario_id = u.id
		  GROUP BY u.id
		  ORDER BY u.criado_em DESC
		  LIMIT $1 OFFSET $2`,
		[limite, deslocamento],
	);
	return rows;
}

export async function definirAtivo(id, ativo) {
	const { rows } = await pool.query(
		`UPDATE usuario SET ativo = $2 WHERE id = $1 RETURNING ${CAMPOS_PUBLICOS}`,
		[id, ativo],
	);
	return rows[0] ?? null;
}

export async function contar() {
	const { rows } = await pool.query("SELECT count(*)::int AS total FROM usuario");
	return rows[0].total;
}
