/**
 * Formatacao e escrita dos logs no console.
 *
 * Modulo puro de proposito: nao conhece banco, nao conhece HTTP, nao
 * importa nada do projeto. Isso o torna testavel sozinho e evita que o
 * registro de log dependa do banco estar de pe - um erro de conexao
 * ainda precisa aparecer em algum lugar.
 *
 * A gravacao na tabela log_evento fica em servicos/registro.js, que
 * combina este modulo com o repositorio.
 */

const NIVEIS_VALIDOS = new Set(["info", "aviso", "erro"]);

/**
 * Campos que nunca podem ir para o log, em nenhum nivel. A lista existe
 * porque o caminho mais comum de vazamento e alguem registrar o corpo
 * inteiro de uma requisicao durante uma depuracao e esquecer de tirar.
 */
const CAMPOS_PROIBIDOS = new Set([
	"senha",
	"senha_hash",
	"senhaHash",
	"password",
	"confirmacaoSenha",
	"token",
	"cookie",
	"authorization",
	"sid",
]);

/**
 * Remove recursivamente os campos sensiveis de um objeto antes de ele
 * virar texto de log. Substitui por um marcador em vez de apagar, para
 * que fique visivel que havia algo ali.
 */
export function limpar(valor, profundidade = 0) {
	if (profundidade > 4 || valor === null || typeof valor !== "object") {
		return valor;
	}

	if (Array.isArray(valor)) {
		return valor.map((item) => limpar(item, profundidade + 1));
	}

	const saida = {};
	for (const [chave, conteudo] of Object.entries(valor)) {
		saida[chave] = CAMPOS_PROIBIDOS.has(chave)
			? "[omitido]"
			: limpar(conteudo, profundidade + 1);
	}
	return saida;
}

/**
 * Monta a linha de log. Separada da escrita para poder ser testada sem
 * capturar o console.
 *
 * Formato: 2026-10-13T14:02:11.483Z [INFO ] login_sucesso usuario=3 ip=127.0.0.1 | ...
 */
export function formatar(nivel, evento, contexto = {}) {
	const partes = [
		new Date().toISOString(),
		`[${nivel.toUpperCase().padEnd(5)}]`,
		evento,
	];

	const { usuarioId, ip, detalhe, ...resto } = contexto;

	if (usuarioId !== undefined && usuarioId !== null) partes.push(`usuario=${usuarioId}`);
	if (ip) partes.push(`ip=${ip}`);
	if (detalhe) partes.push(`| ${detalhe}`);

	if (Object.keys(resto).length > 0) {
		partes.push(JSON.stringify(limpar(resto)));
	}

	return partes.join(" ");
}

export function escrever(nivel, evento, contexto = {}) {
	if (!NIVEIS_VALIDOS.has(nivel)) {
		throw new Error(`Nivel de log invalido: "${nivel}".`);
	}

	const linha = formatar(nivel, evento, contexto);

	// stderr para erro e aviso, stdout para info: permite separar os
	// fluxos na hora de redirecionar para arquivo.
	if (nivel === "erro" || nivel === "aviso") {
		console.error(linha);
	} else {
		console.log(linha);
	}
}
