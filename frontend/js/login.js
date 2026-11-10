/**
 * Autenticacao, agora contra o servidor.
 *
 * O que mudou em relacao ao Trabalho I, e por que:
 *
 *   antes  -  o navegador comparava a senha com um par fixo escrito
 *             neste arquivo, e gravava "logado" no localStorage.
 *             Qualquer pessoa lia as credenciais no codigo-fonte ou
 *             escrevia a chave pelo console e entrava.
 *
 *   agora  -  POST /api/sessao. O servidor compara a senha com um hash
 *             bcrypt e devolve um cookie httpOnly, que o JavaScript
 *             desta pagina nao consegue ler nem forjar.
 *
 * Nenhuma credencial existe mais neste arquivo.
 */

import { sessao, ErroApi } from "./api.js";
import { montarBarraDeSessao } from "./sessao-ui.js";

const formulario = document.getElementById("form_login");
const campoEmail = document.getElementById("email_usuario");
const campoSenha = document.getElementById("senha");
const mensagemErro = document.getElementById("mensagem_erro");
const botao = formulario?.querySelector("button[type='submit']");

montarBarraDeSessao();

/**
 * Para onde ir depois de entrar.
 *
 * A biblioteca redireciona para ca com ?voltar=biblioteca.html quando o
 * visitante tenta acessa-la sem sessao. Assim ele volta ao que queria
 * fazer, em vez de cair na pagina inicial.
 *
 * O valor e limitado a nomes de arquivo .html desta pasta: aceitar
 * qualquer endereco permitiria um redirecionamento aberto, em que um
 * link como login.html?voltar=https://site-falso levaria o usuario para
 * fora do site logo depois de ele digitar a senha.
 */
function destinoDepoisDoLogin() {
	const pedido = new URLSearchParams(window.location.search).get("voltar") ?? "";
	return /^[a-z0-9_-]+\.html$/i.test(pedido) ? pedido : "index.html";
}

function mostrarErro(texto) {
	if (!mensagemErro) return;
	mensagemErro.textContent = texto;
	mensagemErro.hidden = false;
}

function limparErro() {
	if (!mensagemErro) return;
	mensagemErro.hidden = true;
	mensagemErro.textContent = "";
}

formulario?.addEventListener("submit", async (evento) => {
	evento.preventDefault();
	limparErro();

	// Desabilitar evita o envio duplo de quem clica duas vezes - que no
	// servidor contaria como duas tentativas no limite de taxa.
	if (botao) {
		botao.disabled = true;
		botao.dataset.textoOriginal = botao.textContent;
		botao.textContent = "Entrando...";
	}

	try {
		await sessao.entrar(campoEmail.value.trim(), campoSenha.value);
		window.location.href = destinoDepoisDoLogin();
	} catch (erro) {
		// A senha digitada sai do campo, o e-mail fica: errar a senha nao
		// deve obrigar a redigitar o e-mail.
		campoSenha.value = "";
		campoSenha.focus();

		if (erro instanceof ErroApi) {
			mostrarErro(erro.mensagem);
		} else {
			mostrarErro("Nao foi possivel falar com o servidor. Verifique sua conexao.");
		}
	} finally {
		if (botao) {
			botao.disabled = false;
			botao.textContent = botao.dataset.textoOriginal ?? "Entrar";
		}
	}
});
