/**
 * Rotas de conversao no servidor.
 *
 *   GET  /api/conversoes/formatos   o que este servidor consegue converter
 *   POST /api/conversoes            converte um arquivo
 *
 * Estas rotas atendem ANONIMO e LOGADO. Converter nao exige conta - e a
 * decisao do Trabalho I ("o cadastro nao e obrigatorio") continuando a
 * valer. O que exige sessao e apenas pedir para guardar o resultado.
 */

import { Router } from "express";

import * as conversao from "../servicos/conversao.js";
import * as biblioteca from "../servicos/biblioteca.js";
import { registrar, EVENTOS, ipDaRequisicao } from "../servicos/registro.js";
import { carregarUsuarioSeHouver } from "../middlewares/exigir-login.js";
import { receberArquivo } from "../middlewares/upload.js";
import { limiteConversao } from "../middlewares/limites.js";
import { erros } from "../util/erros.js";
import { sanitizarNomeArquivo, nomeAscii, extensaoDe } from "../util/formatos.js";

export const rotasConversoes = Router();

/* ---------------------------------------------------------------------
 *  GET /api/conversoes/formatos
 *
 *  O cliente pergunta ao servidor o que ele consegue fazer, em vez de a
 *  lista estar duplicada no JavaScript da pagina. Assim, instalar ou
 *  remover uma ferramenta se reflete na interface sem alterar o
 *  front-end.
 * ------------------------------------------------------------------- */
rotasConversoes.get("/conversoes/formatos", (req, res) => {
	res.json({
		servidor: conversao.conversoesDisponiveis(),
		fila: conversao.filaConversao.estado(),
	});
});

/* ---------------------------------------------------------------------
 *  POST /api/conversoes
 *
 *  Campos: arquivo, formatoDestino, guardar ("1" para tambem guardar).
 *
 *  Responde SEMPRE com o arquivo convertido, como download. Quando o
 *  resultado tambem foi guardado, o identificador do item vai no
 *  cabecalho X-Item-Id - assim o cliente recebe o arquivo de imediato e
 *  ainda sabe o que acabou de entrar na biblioteca.
 * ------------------------------------------------------------------- */
rotasConversoes.post(
	"/conversoes",
	limiteConversao,
	carregarUsuarioSeHouver,
	receberArquivo,
	async (req, res, proximo) => {
		const ip = ipDaRequisicao(req);

		try {
			if (!req.file?.buffer?.length) {
				throw erros.entradaInvalida("Nenhum arquivo foi enviado.");
			}

			const nomeEnviado = sanitizarNomeArquivo(req.file.originalname);
			const origem = extensaoDe(nomeEnviado);
			const destino = String(req.body?.formatoDestino ?? "").toLowerCase();

			if (!origem) {
				throw erros.entradaInvalida("O arquivo precisa ter extensao no nome.");
			}

			const resultado = await conversao.converter({
				buffer: req.file.buffer,
				de: origem,
				para: destino,
			});

			const nomeSaida = trocarExtensao(nomeEnviado, resultado.formato);

			// Guardar e um pedido SEPARADO do de converter, e so vale para
			// quem tem conta. Anonimo converte e baixa; nada fica.
			let itemId = null;
			const querGuardar = req.body?.guardar === "1" || req.body?.guardar === "true";

			if (querGuardar) {
				if (!req.usuario) {
					throw erros.naoAutenticado();
				}

				const item = await biblioteca.guardar({
					usuarioId: req.usuario.id,
					buffer: resultado.buffer,
					nomeArquivo: nomeSaida,
					formatoOrigem: origem,
					formatoDestino: resultado.formato,
					origemConversao: "servidor",
				});
				itemId = item.id;
			}

			registrar("info", EVENTOS.CONVERSAO_CRIADA, {
				usuarioId: req.usuario?.id ?? null,
				ip,
				detalhe:
					`${origem}->${resultado.formato} ${req.file.buffer.length}B->` +
					`${resultado.buffer.length}B guardado=${itemId ?? "nao"}`,
			});

			// Os mesmos tres cabecalhos do download da biblioteca: o
			// conteudo devolvido veio de um arquivo do usuario e nao pode
			// ser interpretado como HTML pelo navegador.
			res.set({
				"Content-Type": "application/octet-stream",
				"Content-Disposition":
					`attachment; filename="${nomeAscii(nomeSaida)}"; ` +
					`filename*=UTF-8''${encodeURIComponent(nomeSaida)}`,
				"Content-Length": String(resultado.buffer.length),
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": "private, no-store",
			});

			if (itemId !== null) res.set("X-Item-Id", String(itemId));

			res.send(resultado.buffer);
		} catch (erro) {
			proximo(erro);
		}
	},
);

function trocarExtensao(nome, novaExtensao) {
	const ponto = nome.lastIndexOf(".");
	const base = ponto > 0 ? nome.slice(0, ponto) : nome;
	return `${base}.${novaExtensao}`;
}
