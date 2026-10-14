/**
 * Populacao inicial do banco para DESENVOLVIMENTO.
 *
 * Uso:   npm run seed     (a partir de backend/)
 *
 * Por que isto e um script e nao um seed.sql: um hash bcrypt depende de
 * um sal aleatorio gerado na hora. Colar um hash pronto dentro de um
 * .sql versionado seria, na pratica, publicar a senha. Aqui as senhas de
 * teste aparecem no codigo porque sao descartaveis e de desenvolvimento;
 * o hash e calculado em tempo de execucao.
 *
 * Por que mora em backend/scripts/ e nao em sql/: o Node resolve
 * node_modules subindo a partir do arquivo que importa. Um script em
 * sql/ procuraria em sql/node_modules e depois na raiz do projeto, e
 * nunca encontraria backend/node_modules.
 *
 * O script e reexecutavel: rodar de novo redefine as senhas em vez de
 * falhar por e-mail duplicado.
 */

import bcrypt from "bcryptjs";

import { config } from "../src/config/index.js";
import { pool } from "../src/dados/pool.js";
import * as usuarioRepo from "../src/dados/usuario-repo.js";

const CUSTO_BCRYPT = 12;

const USUARIOS = [
	{
		nome: "Administrador de Teste",
		email: "admin@freevertio.local",
		senha: "AdminTeste123",
		perfil: "admin",
	},
	{
		nome: "Usuario de Teste",
		email: "usuario@freevertio.local",
		senha: "UsuarioTeste123",
		perfil: "usuario",
	},
];

/**
 * Trava de seguranca. Estas contas tem senha conhecida e publicada no
 * repositorio; criar qualquer uma delas fora de desenvolvimento seria
 * abrir uma porta com a chave colada na fechadura.
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

	for (const u of USUARIOS) {
		const senhaHash = await bcrypt.hash(u.senha, CUSTO_BCRYPT);

		const usuario = await usuarioRepo.criarOuRedefinirSenha({
			nome: u.nome,
			email: u.email,
			senhaHash,
			perfil: u.perfil,
		});

		console.log(`  id=${usuario.id}  ${usuario.email}  (${usuario.perfil})`);
	}

	console.log("\nCredenciais de desenvolvimento:");
	for (const u of USUARIOS) {
		console.log(`  ${u.email.padEnd(26)} ${u.senha}`);
	}
	console.log("\nNAO use estas contas fora da sua maquina.");
}

popular()
	.then(() => pool.end())
	.catch(async (erro) => {
		console.error("Falha ao popular o banco:", erro.message);
		await pool.end().catch(() => {});
		process.exit(1);
	});
