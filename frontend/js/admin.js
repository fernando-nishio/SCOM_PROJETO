/**
 * Area administrativa.
 *
 * Mostra estatisticas, contas e registros de eventos, e permite ativar
 * ou desativar uma conta.
 *
 * Esta pagina nao protege nada. Ela so e alcancavel por quem tem perfil
 * admin porque o servidor recusa as rotas /api/admin/* a qualquer outro
 * - e recusaria mesmo que alguem abrisse este arquivo direto. O
 * redirecionamento aqui existe para nao mostrar uma tela cheia de erros
 * a quem nao deveria estar nela.
 *
 * Como em toda a interface: textContent, nunca innerHTML. Os logs
 * contem detalhes e nomes vindos de usuarios, e sao o lugar mais provavel
 * de alguem tentar injetar HTML.
 */

import { administracao, ErroApi, formatarTamanho, formatarData } from "./api.js";
import { exigirSessao } from "./sessao-ui.js";

const el = {
	painel: document.getElementById("painel_estatisticas"),
	avisoOrfaos: document.getElementById("aviso_orfaos"),
	corpoUsuarios: document.getElementById("corpo_usuarios"),
	corpoLogs: document.getElementById("corpo_logs"),
	filtroNivel: document.getElementById("filtro_nivel"),
	atualizarLogs: document.getElementById("atualizar_logs"),
	mensagem: document.getElementById("mensagem"),
	erro: document.getElementById("mensagem_erro"),
};

let usuarioAtual = null;

/* ---------------------------------------------------------------------
 *  Mensagens
 * ------------------------------------------------------------------- */

function avisar(texto) {
	el.erro.hidden = true;
	el.mensagem.textContent = texto;
	el.mensagem.hidden = false;
	setTimeout(() => (el.mensagem.hidden = true), 4000);
}

function tratar(erro) {
	if (erro instanceof ErroApi && erro.ehSessaoExpirada) {
		window.location.href = "login.html?voltar=admin.html";
		return;
	}
	el.mensagem.hidden = true;
	el.erro.textContent = erro.mensagem ?? "Ocorreu um erro inesperado.";
	el.erro.hidden = false;
}

/** Celula de tabela com texto simples. */
function celula(texto, classe) {
	const td = document.createElement("td");
	td.textContent = texto ?? "—";
	if (classe) td.className = classe;
	return td;
}

function selo(texto, tipo) {
	const span = document.createElement("span");
	span.className = `selo selo_${tipo}`;
	span.textContent = texto;
	return span;
}

/* ---------------------------------------------------------------------
 *  Estatisticas
 * ------------------------------------------------------------------- */

function cartao(valor, rotulo) {
	const li = document.createElement("li");
	li.className = "cartao_estatistica";

	const numero = document.createElement("span");
	numero.className = "cartao_valor";
	numero.textContent = valor;

	const texto = document.createElement("span");
	texto.className = "cartao_rotulo";
	texto.textContent = rotulo;

	li.append(numero, texto);
	return li;
}

async function carregarEstatisticas() {
	try {
		const dados = await administracao.estatisticas();

		el.painel.replaceChildren(
			cartao(dados.usuarios.total, "contas"),
			cartao(dados.conversoes.total, "conversões guardadas"),
			cartao(dados.conversoes.convertidasLocal, "convertidas no navegador"),
			cartao(dados.conversoes.convertidasServidor, "convertidas no servidor"),
			cartao(formatarTamanho(dados.armazenamento.bytesEmDisco), "em disco"),
			cartao(dados.fila.emExecucao, "conversões em andamento"),
		);

		// A diferenca entre o somatorio do banco e o que ha em disco
		// revela arquivos orfaos - rastro de uma remocao que falhou depois
		// de a linha ja ter sido apagada. Zero e o esperado.
		const diferenca = dados.armazenamento.diferencaBytes;
		if (diferenca !== 0) {
			el.avisoOrfaos.textContent =
				`Há ${formatarTamanho(Math.abs(diferenca))} de diferença entre o que o banco ` +
				`registra e o que existe em disco. Diferente de zero indica arquivos órfãos.`;
			el.avisoOrfaos.hidden = false;
		} else {
			el.avisoOrfaos.hidden = true;
		}
	} catch (erro) {
		tratar(erro);
	}
}

/* ---------------------------------------------------------------------
 *  Contas
 * ------------------------------------------------------------------- */

function linhaUsuario(usuario) {
	const tr = document.createElement("tr");

	tr.append(
		celula(usuario.nome),
		celula(usuario.email),
	);

	const tdPerfil = document.createElement("td");
	tdPerfil.append(
		usuario.perfil === "admin" ? selo("admin", "admin") : document.createTextNode("usuário"),
	);
	tr.append(tdPerfil);

	tr.append(
		celula(String(usuario.totalConversoes)),
		celula(formatarData(usuario.criadoEm)),
	);

	const tdSituacao = document.createElement("td");

	const botao = document.createElement("button");
	botao.type = "button";
	botao.className = usuario.ativo ? "botao_pequeno botao_perigo" : "botao_pequeno";
	botao.textContent = usuario.ativo ? "Desativar" : "Reativar";
	botao.setAttribute(
		"aria-label",
		`${usuario.ativo ? "Desativar" : "Reativar"} a conta de ${usuario.email}`,
	);

	// A trava de nao se autodesativar existe no servidor, que e quem
	// decide. Desabilitar o botao aqui apenas evita oferecer uma acao
	// que seria recusada.
	const ehEuMesmo = usuarioAtual && usuario.id === usuarioAtual.id;
	if (ehEuMesmo && usuario.ativo) {
		botao.disabled = true;
		botao.title = "Um administrador não pode desativar a própria conta.";
	}

	botao.addEventListener("click", () => alternarConta(usuario));

	if (!usuario.ativo) tdSituacao.append(selo("inativa", "inativo"), " ");
	tdSituacao.append(botao);
	tr.append(tdSituacao);

	return tr;
}

async function alternarConta(usuario) {
	try {
		await administracao.definirAtivo(usuario.id, !usuario.ativo);
		avisar(`A conta de ${usuario.email} foi ${usuario.ativo ? "desativada" : "reativada"}.`);
		await Promise.all([carregarUsuarios(), carregarEstatisticas()]);
	} catch (erro) {
		tratar(erro);
	}
}

async function carregarUsuarios() {
	try {
		const { usuarios } = await administracao.usuarios();
		el.corpoUsuarios.replaceChildren(...usuarios.map(linhaUsuario));
	} catch (erro) {
		tratar(erro);
	}
}

/* ---------------------------------------------------------------------
 *  Logs
 * ------------------------------------------------------------------- */

function linhaLog(registro) {
	const tr = document.createElement("tr");

	tr.append(celula(formatarData(registro.ocorridoEm)));

	const tdNivel = document.createElement("td");
	tdNivel.append(selo(registro.nivel, registro.nivel));
	tr.append(tdNivel);

	tr.append(
		celula(registro.evento, "celula_monoespacada"),
		celula(registro.usuario?.email ?? "—"),
		celula(registro.ip ?? "—", "celula_monoespacada"),
		celula(registro.detalhe ?? "—", "celula_monoespacada"),
	);

	return tr;
}

async function carregarLogs() {
	try {
		const { logs } = await administracao.logs({
			nivel: el.filtroNivel.value || null,
			pagina: 1,
		});

		if (logs.length === 0) {
			const tr = document.createElement("tr");
			const td = celula("Nenhum evento registrado com este filtro.");
			td.colSpan = 6;
			tr.append(td);
			el.corpoLogs.replaceChildren(tr);
			return;
		}

		el.corpoLogs.replaceChildren(...logs.map(linhaLog));
	} catch (erro) {
		tratar(erro);
	}
}

el.filtroNivel?.addEventListener("change", carregarLogs);
el.atualizarLogs?.addEventListener("click", () => {
	carregarLogs();
	carregarEstatisticas();
});

/* ---------------------------------------------------------------------
 *  Inicio
 * ------------------------------------------------------------------- */

exigirSessao({ perfil: "admin" }).then((usuario) => {
	if (!usuario) return;

	usuarioAtual = usuario;
	carregarEstatisticas();
	carregarUsuarios();
	carregarLogs();
});
