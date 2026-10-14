/**
 * Regra de negocio da autenticacao.
 *
 * Nao conhece req nem res: recebe valores, devolve valores, lanca
 * ErroApp. E o que permite testar o cadastro e a verificacao de senha
 * sem subir um servidor HTTP.
 */

import bcrypt from "bcryptjs";

import { erros } from "../util/erros.js";
import { validarNome, validarEmail, validarSenha } from "../util/validacao.js";
import * as usuarioRepo from "../dados/usuario-repo.js";

/**
 * Custo do bcrypt: cada incremento dobra o tempo de calculo. 12 leva uns
 * 250 ms numa maquina comum - rapido o bastante para um login, caro o
 * bastante para inviabilizar forca bruta em massa sobre o hash vazado.
 */
const CUSTO_BCRYPT = 12;

/**
 * Hash descartavel, calculado uma vez na subida do modulo.
 *
 * Serve para o caso "e-mail nao cadastrado": sem ele, a resposta sairia
 * na hora, enquanto o caso "senha errada" gastaria os 250 ms do bcrypt.
 * Essa diferenca de tempo e mensuravel e revela quais e-mails existem no
 * sistema - um ataque de enumeracao por canal lateral.
 */
const HASH_DESCARTAVEL = bcrypt.hashSync("comparacao-de-tempo-constante", CUSTO_BCRYPT);

/**
 * Cadastra um usuario novo. Sempre com perfil 'usuario': a promocao a
 * administrador e feita direto no banco, nunca por rota exposta.
 */
export async function cadastrar({ nome, email, senha }) {
	const nomeLimpo = validarNome(nome);
	const emailLimpo = validarEmail(email);
	const senhaLimpa = validarSenha(senha);

	if (await usuarioRepo.existeEmail(emailLimpo)) {
		throw erros.conflito("Este e-mail ja esta cadastrado.");
	}

	const senhaHash = await bcrypt.hash(senhaLimpa, CUSTO_BCRYPT);

	// A corrida entre o existeEmail acima e este INSERT e real: duas
	// requisicoes simultaneas com o mesmo e-mail passam as duas pela
	// verificacao. Quem decide e o UNIQUE do banco - o codigo 23505 vira
	// 409 no tradutor do middleware de erros.
	return usuarioRepo.criar({
		nome: nomeLimpo,
		email: emailLimpo,
		senhaHash,
		perfil: "usuario",
	});
}

/**
 * Verifica as credenciais.
 *
 * Em QUALQUER falha devolve a mesma mensagem, sem distinguir "e-mail
 * inexistente" de "senha errada". Mensagens diferentes transformam a
 * tela de login num verificador de cadastro: o atacante descobre quais
 * e-mails existem antes de tentar qualquer senha.
 */
export async function verificarCredenciais({ email, senha }) {
	// Entrada malformada nao vaza pelo formato do erro: tratada como
	// credencial invalida, igual ao resto.
	let emailLimpo;
	try {
		emailLimpo = validarEmail(email);
	} catch {
		await bcrypt.compare(String(senha ?? ""), HASH_DESCARTAVEL);
		throw erros.entradaInvalida("E-mail ou senha incorretos.");
	}

	const usuario = await usuarioRepo.buscarPorEmailParaLogin(emailLimpo);

	if (!usuario) {
		// Gasta o mesmo tempo de um bcrypt real antes de recusar.
		await bcrypt.compare(String(senha ?? ""), HASH_DESCARTAVEL);
		throw erros.entradaInvalida("E-mail ou senha incorretos.");
	}

	const senhaConfere = await bcrypt.compare(String(senha ?? ""), usuario.senha_hash);
	if (!senhaConfere) {
		throw erros.entradaInvalida("E-mail ou senha incorretos.");
	}

	// Conta desativada tem mensagem propria: aqui a senha ja foi
	// confirmada, entao nao ha o que proteger, e o usuario precisa saber
	// por que nao consegue entrar.
	if (!usuario.ativo) {
		throw erros.semPermissao();
	}

	// Remove o hash antes de devolver. A desestruturacao e o que impede
	// que ele chegue ao JSON de resposta por descuido.
	const { senha_hash: _, ...dadosPublicos } = usuario;
	return dadosPublicos;
}
