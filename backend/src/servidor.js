/**
 * Ponto de entrada do backend do Freevertio.
 *
 * Responsabilidade unica: montar a aplicacao na ordem certa e subir.
 * Nenhuma regra de negocio mora aqui.
 *
 * A ORDEM dos middlewares importa e nao e arbitraria:
 *   1. seguranca de cabecalhos   (antes de qualquer resposta sair)
 *   2. leitura do corpo          (antes de quem le req.body)
 *   3. sessao                    (antes de quem le req.session)
 *   4. estaticos e rotas
 *   5. rota nao encontrada       (depois de todas as rotas)
 *   6. tratador de erros         (sempre por ultimo)
 */

import fs from "node:fs/promises";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import connectPgSimple from "connect-pg-simple";

import { config } from "./config/index.js";
import { pool, verificarConexao, encerrarPool } from "./dados/pool.js";
import { registrar, EVENTOS } from "./servicos/registro.js";
import { escrever } from "./util/logger.js";
import { rotaNaoEncontrada, tratadorDeErros } from "./middlewares/erros.js";
import { limiteGeral } from "./middlewares/limites.js";
import { verificarCsrf, rotaToken } from "./middlewares/csrf.js";
import { rotasSaude } from "./rotas/saude.js";
import { rotasAutenticacao } from "./rotas/autenticacao.js";
import { rotasBiblioteca } from "./rotas/biblioteca.js";
import { rotasConversoes } from "./rotas/conversoes.js";
import { rotasAdmin } from "./rotas/admin.js";
import { detectarFerramentas } from "./servicos/conversao.js";

const app = express();

// req.ip reflete o cliente real quando houver proxy reverso na frente.
// Sem isto, o rate limit e os logs registrariam sempre o IP do proxy.
app.set("trust proxy", 1);

// Nao anunciar que o servidor e Express.
app.disable("x-powered-by");

// --- 1. Cabecalhos de seguranca --------------------------------------
app.use(helmet());

// Nenhuma resposta da API pode ser interpretada como outro tipo de
// conteudo pelo navegador. Vale sobretudo para os downloads da
// biblioteca: sem isto, um SVG guardado poderia ser servido como HTML e
// executar script na origem da aplicacao.
app.use((req, res, proximo) => {
	res.set("X-Content-Type-Options", "nosniff");
	proximo();
});

// --- 2. Leitura do corpo ---------------------------------------------
// O limite baixo e deliberado: as rotas JSON nunca recebem arquivo
// (upload passa por multipart, tratado pelo multer na rota de conversao).
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// --- 3. Sessao -------------------------------------------------------
const ArmazenamentoSessao = connectPgSimple(session);

app.use(
	session({
		store: new ArmazenamentoSessao({
			pool,
			tableName: config.sessao.tabela,
			// A tabela vem do schema.sql, nao da biblioteca: assim ela
			// aparece no script que o enunciado exige entregar.
			createTableIfMissing: false,
		}),
		name: config.sessao.nomeCookie,
		secret: config.sessao.segredo,

		// Nao reescreve a sessao a cada requisicao sem necessidade.
		resave: false,

		// Nao cria sessao para visitante anonimo. Quem so converte no
		// navegador nao gera linha na tabela sessao.
		saveUninitialized: false,

		cookie: {
			// JavaScript da pagina nao le este cookie. E o que impede um
			// XSS eventual de roubar a sessao.
			httpOnly: true,

			// Em producao o cookie so viaja por HTTPS. Em
			// desenvolvimento precisa ser falso, senao o navegador o
			// descarta em http://localhost.
			secure: !config.desenvolvimento,

			// O navegador nao envia este cookie em requisicao originada
			// de outro site. E a defesa primaria contra CSRF.
			sameSite: "strict",

			maxAge: config.sessao.duracaoMs,
		},
	}),
);

// --- 4. Frontend estatico e rotas ------------------------------------
// Serve apenas frontend/. O diretorio armazenamento/ fica FORA daqui de
// proposito: os arquivos dos usuarios so podem ser alcancados por uma
// rota que verifica sessao, dono e cabecalhos de download.
app.use(express.static(config.caminhoFrontend));

// A rota de diagnostico fica FORA do limite geral: quando a API esta
// recusando por excesso de requisicoes, é justamente quando se precisa
// conseguir perguntar como ela está.
app.use("/api", rotasSaude);

app.use("/api", limiteGeral);

// Entrega do token CSRF. Antes do verificarCsrf: e um GET, e o cliente
// precisa conseguir buscar o token sem ja possuir um.
app.get("/api/csrf", rotaToken);

// A partir daqui, toda requisicao autenticada que muda estado precisa
// apresentar o token. Metodos de leitura e requisicoes anonimas passam.
app.use("/api", verificarCsrf);

app.use("/api", rotasAutenticacao);
app.use("/api", rotasBiblioteca);
app.use("/api", rotasConversoes);
app.use("/api/admin", rotasAdmin);

// --- 5 e 6. Nao encontrada e erros -----------------------------------
app.use(rotaNaoEncontrada);
app.use(tratadorDeErros);

// ---------------------------------------------------------------------
//  Subida
// ---------------------------------------------------------------------
async function iniciar() {
	// O diretorio de armazenamento esta no .gitignore, e o Git nao
	// versiona diretorio vazio - num clone novo ele nao existe. Criar na
	// subida evita que a aplicacao quebre na primeira gravacao.
	await fs.mkdir(config.caminhoArmazenamento, { recursive: true });

	// Falhar agora, com mensagem clara, e melhor do que falhar no
	// primeiro login do avaliador.
	const info = await verificarConexao();

	// Descobre quais conversores existem nesta maquina. Feito na subida
	// para que a rota /api/conversoes/formatos responda sem custo e para
	// que a ausencia de uma ferramenta apareca no log, e nao so quando um
	// usuario tentar usa-la.
	await detectarFerramentas();

	const servidor = app.listen(config.porta, () => {
		escrever("info", "servidor_iniciado", {
			detalhe:
				`http://localhost:${config.porta} | ambiente=${config.ambiente} | ` +
				`banco=${info.banco}`,
		});
		registrar("info", EVENTOS.SERVIDOR_INICIADO, {
			detalhe: `porta ${config.porta}, ambiente ${config.ambiente}`,
		});
	});

	// Encerramento ordenado: para de aceitar conexoes novas, espera as
	// em andamento e so entao fecha o pool. Sem isto, um Ctrl+C no meio
	// de uma gravacao deixa a transacao pendurada.
	for (const sinal of ["SIGINT", "SIGTERM"]) {
		process.on(sinal, () => {
			escrever("info", "encerrando", { detalhe: `sinal ${sinal}` });
			servidor.close(async () => {
				await encerrarPool();
				process.exit(0);
			});
		});
	}
}

iniciar().catch((erro) => {
	escrever("erro", "falha_na_subida", { detalhe: erro.message });
	console.error(erro);
	process.exit(1);
});
