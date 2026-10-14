/**
 * Rotas administrativas.
 *
 *   GET    /api/admin/usuarios        lista contas
 *   PATCH  /api/admin/usuarios/:id    ativa ou desativa uma conta
 *   GET    /api/admin/conversoes      biblioteca de todos os usuarios
 *   DELETE /api/admin/conversoes/:id  apaga item de qualquer usuario
 *   GET    /api/admin/logs            consulta os logs
 *   GET    /api/admin/estatisticas    numeros de uso
 *
 * O caminho e /api/admin/... e nao um parametro em rotas existentes.
 * Separar os enderecos separa tambem as consultas: as daqui nao filtram
 * por dono, e e justamente por isso que elas nao podem compartilhar
 * codigo com as do usuario comum. Uma condicional errada num caminho
 * unico transformaria "minha biblioteca" em "a biblioteca de todos".
 */

import { Router } from "express";

import * as admin from "../servicos/admin.js";
import { registrar, EVENTOS, ipDaRequisicao } from "../servicos/registro.js";
import { exigirLogin } from "../middlewares/exigir-login.js";
import { exigirPerfil } from "../middlewares/exigir-perfil.js";

export const rotasAdmin = Router();

// As duas verificacoes valem para TODAS as rotas deste arquivo, e sao
// aplicadas aqui em vez de rota a rota: assim uma rota nova acrescentada
// depois ja nasce protegida.
rotasAdmin.use(exigirLogin, exigirPerfil("admin"));

/* --- contas --------------------------------------------------------- */

rotasAdmin.get("/usuarios", async (req, res, proximo) => {
	try {
		res.json(
			await admin.listarUsuarios({
				pagina: req.query.pagina,
				porPagina: req.query.porPagina,
			}),
		);
	} catch (erro) {
		proximo(erro);
	}
});

rotasAdmin.patch("/usuarios/:id", async (req, res, proximo) => {
	try {
		const usuario = await admin.definirContaAtiva({
			adminId: req.usuario.id,
			idBruto: req.params.id,
			ativo: req.body?.ativo,
		});

		// Ativar e desativar conta sao acoes de auditoria: precisam ficar
		// registradas com quem fez e em quem.
		registrar("aviso", usuario.ativo ? "conta_ativada" : "conta_desativada", {
			usuarioId: req.usuario.id,
			ip: ipDaRequisicao(req),
			detalhe: `alvo=${usuario.id} (${usuario.email})`,
		});

		res.json({ usuario });
	} catch (erro) {
		proximo(erro);
	}
});

/* --- biblioteca de todos -------------------------------------------- */

rotasAdmin.get("/conversoes", async (req, res, proximo) => {
	try {
		res.json(
			await admin.listarTodasConversoes({
				pagina: req.query.pagina,
				porPagina: req.query.porPagina,
			}),
		);
	} catch (erro) {
		proximo(erro);
	}
});

rotasAdmin.delete("/conversoes/:id", async (req, res, proximo) => {
	try {
		const item = await admin.apagarConversao(req.params.id);

		registrar("aviso", EVENTOS.ITEM_APAGADO, {
			usuarioId: req.usuario.id,
			ip: ipDaRequisicao(req),
			detalhe: `id=${item.id} apagado pela administracao`,
		});

		res.status(204).end();
	} catch (erro) {
		proximo(erro);
	}
});

/* --- observabilidade ------------------------------------------------ */

rotasAdmin.get("/logs", async (req, res, proximo) => {
	try {
		res.json(
			await admin.listarLogs({
				nivel: req.query.nivel ?? null,
				pagina: req.query.pagina,
				porPagina: req.query.porPagina,
			}),
		);
	} catch (erro) {
		proximo(erro);
	}
});

rotasAdmin.get("/estatisticas", async (req, res, proximo) => {
	try {
		res.json(await admin.estatisticas({ desdeHoras: req.query.desdeHoras }));
	} catch (erro) {
		proximo(erro);
	}
});
