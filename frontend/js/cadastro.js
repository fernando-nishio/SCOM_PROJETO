/**
 * Criacao de conta.
 *
 * A validacao daqui e conveniencia: ela avisa antes de gastar uma ida ao
 * servidor. A validacao que VALE acontece no backend, em
 * util/validacao.js, e repete tudo o que esta aqui.
 *
 * Os dois conjuntos precisam existir. So o cliente nao protege nada -
 * qualquer um envia uma requisicao direto para a API, sem passar por
 * esta pagina. So o servidor funcionaria, mas faria o usuario descobrir
 * que a senha e curta demais depois do envio.
 */

import { sessao, ErroApi } from "./api.js";
import { montarBarraDeSessao } from "./sessao-ui.js";

const SENHA_MINIMA = 8;

const formulario = document.getElementById("form_cadastro");
const campoNome = document.getElementById("nome_usuario");
const campoEmail = document.getElementById("email_usuario");
const campoSenha = document.getElementById("senha");
const campoConfirmacao = document.getElementById("senha_confirmacao");
const mensagemErro = document.getElementById("mensagem_erro");
const mensagemOk = document.getElementById("mensagem_sucesso");
const botao = formulario?.querySelector("button[type='submit']");

montarBarraDeSessao();

function mostrarErro(texto, campo) {
	if (mensagemOk) mensagemOk.hidden = true;
	if (mensagemErro) {
		mensagemErro.textContent = texto;
		mensagemErro.hidden = false;
	}
	campo?.focus();
}

function limparMensagens() {
	if (mensagemErro) mensagemErro.hidden = true;
	if (mensagemOk) mensagemOk.hidden = true;
}

/**
 * @returns {string|null} mensagem de erro, ou null se estiver tudo certo
 */
function conferirCampos() {
	if (campoNome.value.trim().length < 2) {
		return ["Informe seu nome completo.", campoNome];
	}
	if (campoSenha.value.length < SENHA_MINIMA) {
		return [`A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`, campoSenha];
	}

	// O bcrypt ignora em silencio tudo alem de 72 bytes. Contar BYTES e
	// nao caracteres importa: um emoji ocupa 4.
	if (new TextEncoder().encode(campoSenha.value).length > 72) {
		return ["A senha e longa demais. Use no maximo 72 bytes.", campoSenha];
	}

	// Conferencia que so existe no cliente: o servidor nunca recebe a
	// confirmacao, porque ela nao e um dado do cadastro - e uma protecao
	// contra erro de digitacao.
	if (campoSenha.value !== campoConfirmacao.value) {
		return ["As duas senhas nao conferem.", campoConfirmacao];
	}

	return null;
}

formulario?.addEventListener("submit", async (evento) => {
	evento.preventDefault();
	limparMensagens();

	const problema = conferirCampos();
	if (problema) {
		return mostrarErro(problema[0], problema[1]);
	}

	if (botao) {
		botao.disabled = true;
		botao.dataset.textoOriginal = botao.textContent;
		botao.textContent = "Criando conta...";
	}

	try {
		await sessao.cadastrar(
			campoNome.value.trim(),
			campoEmail.value.trim(),
			campoSenha.value,
		);

		// Conta criada nao significa sessao aberta: o cadastro e o login
		// sao operacoes diferentes. Entrar em seguida deixa isso
		// explicito e evita um estado meio-logado.
		await sessao.entrar(campoEmail.value.trim(), campoSenha.value);
		window.location.href = "biblioteca.html";
	} catch (erro) {
		if (erro instanceof ErroApi) {
			const campo = erro.codigo === "JA_EXISTE" || erro.codigo === "CONFLITO"
				? campoEmail
				: null;
			mostrarErro(erro.mensagem, campo);
		} else {
			mostrarErro("Nao foi possivel falar com o servidor. Verifique sua conexao.");
		}
	} finally {
		if (botao) {
			botao.disabled = false;
			botao.textContent = botao.dataset.textoOriginal ?? "Criar conta";
		}
	}
});
