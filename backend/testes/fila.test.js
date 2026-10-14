/**
 * Testes da fila de concorrencia.
 *
 * Testam o comportamento que importa: o teto de simultaneidade e
 * respeitado, a vaga e devolvida mesmo quando a tarefa falha, e a fila
 * cheia recusa em vez de aceitar.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { Fila, FilaCheiaError } from "../src/servicos/fila.js";

/** Tarefa que demora e registra o pico de execucoes simultaneas. */
function criarTarefaLenta(estado, ms = 10) {
	return async () => {
		estado.ativas++;
		estado.pico = Math.max(estado.pico, estado.ativas);
		await new Promise((r) => setTimeout(r, ms));
		estado.ativas--;
		return "ok";
	};
}

test("construtor rejeita parametros invalidos", () => {
	assert.throws(() => new Fila({ concorrencia: 0, tamanhoMaximo: 10 }), /concorrencia/);
	assert.throws(() => new Fila({ concorrencia: 1.5, tamanhoMaximo: 10 }), /concorrencia/);
	assert.throws(() => new Fila({ concorrencia: 2, tamanhoMaximo: -1 }), /tamanhoMaximo/);
});

test("executa a tarefa e devolve o resultado", async () => {
	const fila = new Fila({ concorrencia: 2, tamanhoMaximo: 10 });
	assert.equal(await fila.executar(async () => 42), 42);
});

test("nunca ultrapassa o limite de simultaneidade", async () => {
	const fila = new Fila({ concorrencia: 3, tamanhoMaximo: 100 });
	const estado = { ativas: 0, pico: 0 };

	await Promise.all(
		Array.from({ length: 20 }, () => fila.executar(criarTarefaLenta(estado))),
	);

	assert.equal(estado.pico, 3, `pico foi ${estado.pico}, deveria ser 3`);
	assert.equal(estado.ativas, 0);
});

test("com concorrencia 1 as tarefas rodam em serie e na ordem de chegada", async () => {
	const fila = new Fila({ concorrencia: 1, tamanhoMaximo: 10 });
	const ordem = [];

	await Promise.all(
		[1, 2, 3, 4].map((n) =>
			fila.executar(async () => {
				ordem.push(`inicio-${n}`);
				await new Promise((r) => setTimeout(r, 5));
				ordem.push(`fim-${n}`);
			}),
		),
	);

	// Serie de verdade: cada tarefa termina antes de a seguinte comecar.
	assert.deepEqual(ordem, [
		"inicio-1", "fim-1",
		"inicio-2", "fim-2",
		"inicio-3", "fim-3",
		"inicio-4", "fim-4",
	]);
});

test("a vaga e devolvida mesmo quando a tarefa lanca", async () => {
	const fila = new Fila({ concorrencia: 1, tamanhoMaximo: 10 });

	await assert.rejects(
		() => fila.executar(async () => {
			throw new Error("falhou de proposito");
		}),
		/falhou de proposito/,
	);

	// Sem o finally, esta segunda chamada ficaria presa para sempre.
	assert.equal(fila.emExecucao, 0);
	assert.equal(await fila.executar(async () => "seguinte"), "seguinte");
});

test("recusa quando a espera esta cheia, em vez de aceitar sem limite", async () => {
	const fila = new Fila({ concorrencia: 1, tamanhoMaximo: 2 });
	const estado = { ativas: 0, pico: 0 };

	// 1 ocupa a vaga, 2 e 3 esperam: a fila esta cheia.
	const emAndamento = [
		fila.executar(criarTarefaLenta(estado, 30)),
		fila.executar(criarTarefaLenta(estado, 30)),
		fila.executar(criarTarefaLenta(estado, 30)),
	];

	// Deixa o laco de eventos processar as tres chamadas acima.
	await new Promise((r) => setTimeout(r, 5));
	assert.equal(fila.aguardando, 2);

	// A quarta nao cabe.
	await assert.rejects(() => fila.executar(async () => "quarta"), FilaCheiaError);

	await Promise.all(emAndamento);
	assert.equal(estado.pico, 1);
});

test("estado() reflete execucao e espera", async () => {
	const fila = new Fila({ concorrencia: 2, tamanhoMaximo: 5 });
	const estado = { ativas: 0, pico: 0 };

	const emAndamento = Array.from({ length: 5 }, () =>
		fila.executar(criarTarefaLenta(estado, 20)),
	);
	await new Promise((r) => setTimeout(r, 5));

	const agora = fila.estado();
	assert.equal(agora.emExecucao, 2);
	assert.equal(agora.aguardando, 3);
	assert.equal(agora.concorrencia, 2);

	await Promise.all(emAndamento);
	assert.deepEqual(fila.estado(), {
		emExecucao: 0,
		aguardando: 0,
		concorrencia: 2,
		tamanhoMaximo: 5,
	});
});
