/**
 * Rota de diagnostico.
 *
 * Existe para responder uma pergunta so: a aplicacao subiu e consegue
 * falar com o banco? E o primeiro endereco a visitar quando algo nao
 * funciona, e evita confundir "o servidor caiu" com "o banco caiu".
 *
 * Publica de proposito: diagnostico que exige login nao serve para
 * diagnosticar login quebrado. Por isso ela nao revela nada alem do
 * estado - sem versao de banco, sem nome de host, sem contagem de
 * registros.
 */

import { Router } from "express";
import { pool } from "../dados/pool.js";

export const rotasSaude = Router();

rotasSaude.get("/saude", async (req, res) => {
	const inicio = Date.now();
	let banco = "indisponivel";

	try {
		await pool.query("SELECT 1");
		banco = "ok";
	} catch {
		// O estado degradado e a resposta, nao um erro a ser lancado:
		// quem chama esta rota quer justamente saber que o banco caiu.
	}

	const tudoOk = banco === "ok";

	res.status(tudoOk ? 200 : 503).json({
		estado: tudoOk ? "ok" : "degradado",
		banco,
		tempoRespostaMs: Date.now() - inicio,
		tempoNoArMs: Math.round(process.uptime() * 1000),
	});
});
