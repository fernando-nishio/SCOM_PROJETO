/**
 * Populacao inicial do banco para DESENVOLVIMENTO.
 *
 * Uso:   NODE_ENV=development npm run seed     (a partir de backend/)
 *
 * Cria duas contas de teste, um administrador e um usuario comum, com
 * SENHAS ALEATORIAS geradas a cada execucao e impressas uma unica vez no
 * terminal. Nenhuma senha fica escrita neste arquivo nem em lugar nenhum
 * do repositorio: anote as que aparecerem. Rodar o script de novo gera
 * senhas novas e substitui as anteriores.
 *
 * Por que isto e um script e nao um seed.sql: um hash bcrypt depende de
 * um sal aleatorio gerado na hora. Colar um hash pronto dentro de um
 * .sql versionado seria, na pratica, publicar a senha.
 *
 * Por que mora em backend/scripts/ e nao em sql/: o Node resolve
 * node_modules subindo a partir do arquivo que importa. Um script em
 * sql/ procuraria em sql/node_modules e depois na raiz do projeto, e
 * nunca encontraria backend/node_modules.
 */

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

import { config } from "../src/config/index.js";
import { pool } from "../src/dados/pool.js";
import * as usuarioRepo from "../src/dados/usuario-repo.js";

const CUSTO_BCRYPT = 12;

const USUARIOS = [
	{ nome: "Administrador de Teste", email: "admin@freevertio.local", perfil: "admin" },
	{ nome: "Usuario de Teste", email: "usuario@freevertio.local", perfil: "usuario" },
];

/**
 * 12 bytes do gerador criptografico, em base64url: 16 caracteres, cerca
 * de 96 bits de entropia. Fica dentro dos limites que o cadastro exige -
 * pelo menos 8 caracteres e no maximo 72 bytes, o teto do bcrypt.
 */
function senhaAleatoria() {
	return randomBytes(12).toString("base64url");
}

/**
 * Trava de seguranca. O script cria um administrador e redefine a senha
 * de contas existentes; rodado por engano contra um banco real, trocaria
 * o acesso de um administrador por uma senha impressa num terminal.
 */
if (!config.desenvolvimento) {
	console.error(
		`Recusado: NODE_ENV e "${config.ambiente}".\n` +
			"Este script so roda com NODE_ENV=development.",
	);
	process.exit(1);
}

async function popular() {
	console.log(`Populando ${config.banco.database} em ${config.banco.host}...\n`);

	const credenciais = [];

	for (const u of USUARIOS) {
		const senha = senhaAleatoria();
		const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);

		const usuario = await usuarioRepo.criarOuRedefinirSenha({
			nome: u.nome,
			email: u.email,
			senhaHash,
			perfil: u.perfil,
		});

		credenciais.push({ email: usuario.email, senha });
		console.log(`  id=${usuario.id}  ${usuario.email}  (${usuario.perfil})`);
	}

	console.log("\nSenhas geradas agora. ANOTE: elas nao ficam guardadas em lugar nenhum.");
	for (const c of credenciais) {
		console.log(`  ${c.email.padEnd(26)} ${c.senha}`);
	}
	console.log("\nRodar o seed de novo gera senhas novas.");
	console.log("NAO use estas contas fora da sua maquina.");
}

popular()
	.then(() => pool.end())
	.catch(async (erro) => {
		console.error("Falha ao popular o banco:", erro.message);
		await pool.end().catch(() => {});
		process.exit(1);
	});
