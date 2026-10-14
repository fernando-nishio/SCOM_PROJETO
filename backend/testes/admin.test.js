/**
 * Testes das regras da area administrativa que nao dependem de banco.
 *
 * A trava de auto-desativacao foi escrita como funcao pura exatamente
 * para poder ser testada aqui: e uma regra de negocio, nao um detalhe de
 * persistencia, e seria uma pena so descobrir que ela falhou no dia em
 * que o ultimo administrador se trancasse do lado de fora.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { verificarAlteracaoDeConta } from "../src/util/regras.js";
import { exigirPerfil } from "../src/middlewares/exigir-perfil.js";

/* --- trava de auto-desativacao -------------------------------------- */

test("administrador nao pode desativar a propria conta", () => {
	assert.throws(
		() => verificarAlteracaoDeConta({ adminId: 1, alvoId: 1, ativo: false }),
		/propria conta/,
	);
});

test("administrador pode desativar outra conta", () => {
	assert.doesNotThrow(() =>
		verificarAlteracaoDeConta({ adminId: 1, alvoId: 2, ativo: false }),
	);
});

test("administrador pode reativar a propria conta", () => {
	// Reativar a si mesmo nao tranca ninguem para fora, entao e liberado.
	assert.doesNotThrow(() =>
		verificarAlteracaoDeConta({ adminId: 1, alvoId: 1, ativo: true }),
	);
});

/* --- middleware de perfil ------------------------------------------- */

function executar(middleware, req) {
	let resultado = null;
	middleware(req, {}, (erro) => {
		resultado = erro ?? null;
	});
	return resultado;
}

test("exigirPerfil recusa perfil insuficiente com 403", () => {
	const erro = executar(exigirPerfil("admin"), {
		usuario: { id: 2, perfil: "usuario" },
	});

	assert.ok(erro);
	assert.equal(erro.status, 403);
	assert.equal(erro.codigo, "SEM_PERMISSAO");
});

test("exigirPerfil aceita o perfil correto", () => {
	assert.equal(
		executar(exigirPerfil("admin"), { usuario: { id: 1, perfil: "admin" } }),
		null,
	);
});

test("exigirPerfil aceita qualquer um dos perfis listados", () => {
	const middleware = exigirPerfil("admin", "auditor");

	assert.equal(executar(middleware, { usuario: { perfil: "auditor" } }), null);
	assert.equal(executar(middleware, { usuario: { perfil: "admin" } }), null);
	assert.ok(executar(middleware, { usuario: { perfil: "usuario" } }));
});

test("exigirPerfil nega quando req.usuario nao existe", () => {
	// Acontece se alguem montar a rota sem o exigirLogin na frente.
	// Negar e o comportamento seguro: na duvida, nao autoriza.
	const erro = executar(exigirPerfil("admin"), {});

	assert.ok(erro);
	assert.equal(erro.status, 401);
});

test("exigirPerfil sem perfis e erro de programacao, detectado na montagem", () => {
	// Um middleware sem perfis liberaria qualquer um. Melhor quebrar na
	// subida do servidor do que silenciosamente autorizar em producao.
	assert.throws(() => exigirPerfil(), /ao menos um perfil/);
});
