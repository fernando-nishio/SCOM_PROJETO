/**
 * Fila com limite de concorrencia.
 *
 * O problema que ela resolve: converter um DOCX com o LibreOffice custa
 * uns 200 MB de RAM e um nucleo por alguns segundos. Com 4 nucleos e 20
 * requisicoes simultaneas, sao 20 processos e ~4 GB - a maquina comeca a
 * usar swap e as 20 falham por timeout. Nao e degradacao suave, e
 * colapso. Servindo 4 por vez as mesmas 20 terminam ANTES.
 *
 * Uma intuicao comum e que um atraso artificial ajudaria. Ajuda o
 * contrario: cada requisicao fica mais tempo aberta, entao MAIS delas se
 * sobrepoem. O que limita o dano e o teto de simultaneidade, nao a
 * lentidao.
 *
 * Esta classe e pura de proposito - nao importa config nem logger - para
 * que a logica de concorrencia seja testavel sem subir nada. A instancia
 * configurada vive em servicos/conversao.js.
 */

export class FilaCheiaError extends Error {
	constructor(tamanho) {
		super(`Fila cheia (${tamanho} aguardando).`);
		this.name = "FilaCheiaError";
		this.filaCheia = true;
	}
}

export class Fila {
	#concorrencia;
	#tamanhoMaximo;
	#emExecucao = 0;
	#aguardando = [];

	/**
	 * @param {{concorrencia: number, tamanhoMaximo: number}} opcoes
	 */
	constructor({ concorrencia, tamanhoMaximo }) {
		if (!Number.isInteger(concorrencia) || concorrencia < 1) {
			throw new Error("concorrencia deve ser inteiro >= 1.");
		}
		if (!Number.isInteger(tamanhoMaximo) || tamanhoMaximo < 0) {
			throw new Error("tamanhoMaximo deve ser inteiro >= 0.");
		}

		this.#concorrencia = concorrencia;
		this.#tamanhoMaximo = tamanhoMaximo;
	}

	get emExecucao() {
		return this.#emExecucao;
	}

	get aguardando() {
		return this.#aguardando.length;
	}

	/**
	 * Executa a tarefa respeitando o limite de simultaneidade.
	 *
	 * Recusa de imediato quando a espera ja esta cheia. Aceitar trabalho
	 * que nao se vai conseguir fazer e como sistemas morrem: uma recusa
	 * rapida e honesta serve melhor ao cliente do que um timeout de
	 * sessenta segundos.
	 *
	 * @param {() => Promise<T>} tarefa
	 * @returns {Promise<T>}
	 * @template T
	 */
	async executar(tarefa) {
		if (this.#emExecucao >= this.#concorrencia) {
			if (this.#aguardando.length >= this.#tamanhoMaximo) {
				throw new FilaCheiaError(this.#aguardando.length);
			}
			await new Promise((liberar) => this.#aguardando.push(liberar));
		}

		this.#emExecucao++;

		try {
			return await tarefa();
		} finally {
			// O finally e essencial: sem ele, uma tarefa que lanca deixa
			// a vaga ocupada para sempre e a fila trava em silencio.
			this.#emExecucao--;

			const proximo = this.#aguardando.shift();
			if (proximo) proximo();
		}
	}

	/** Estado atual, para a rota de diagnostico e para o relatorio. */
	estado() {
		return {
			emExecucao: this.#emExecucao,
			aguardando: this.#aguardando.length,
			concorrencia: this.#concorrencia,
			tamanhoMaximo: this.#tamanhoMaximo,
		};
	}
}
