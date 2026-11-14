# Roteiro das evidências — Trabalho Individual II

As sete evidências que o enunciado exige anexar ao relatório, mais as capturas
da interface. Cada bloco diz o que rodar, o que você deve ver e o que printar.

Os comandos partem de `/home/varik/S_COM`. Abra **dois terminais**: um com o
servidor rodando, outro para os comandos.

## 0. Preparação

Terminal 1 — servidor, e deixe aberto. Ele é a fonte dos logs:

```bash
cd /home/varik/S_COM/backend
npm run dev
```

Se ainda não criou as contas de teste:

```bash
NODE_ENV=development npm run seed
```

Contas criadas: `admin@freevertio.local` / `AdminTeste123` e
`usuario@freevertio.local` / `UsuarioTeste123`.

Terminal 2 — o resto. Deixe o token CSRF pronto, porque quase tudo precisa dele:

```bash
cd /home/varik/S_COM
JAR=/tmp/jar.txt; rm -f $JAR
TOKEN=$(curl -s -c $JAR http://localhost:3000/api/csrf \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
echo "token: $TOKEN"
```

Se o `echo` sair vazio, o servidor não está no ar.

---

## 1. Resultado dos testes automatizados

> Evidência obrigatória 3. Métrica F, 2 pontos por "evidência de execução".

```bash
cd /home/varik/S_COM/backend && npm test 2>&1 | tail -15
```

**Deve aparecer:** `tests 99`, `pass 99`, `fail 0`.

**Print:** esse resumo final. Um print do rodapé basta; a lista inteira não cabe.

---

## 2. Histórico do Git

> Evidência obrigatória 6. Métrica G, 10 pontos.

```bash
cd /home/varik/S_COM && git log --oneline --graph --decorate -25
```

**Print:** a saída inteira. O enunciado pede exatamente esse comando.

---

## 3. Script de criação do banco

> Evidência obrigatória 1. Métrica B, 2 pontos por "script executável sem erros".

```bash
cd /home/varik/S_COM
psql -h localhost -U freevertio -d freevertio -f sql/schema.sql
```

> **Atenção: este script apaga todos os dados.** Ele começa com `DROP TABLE`
> nas cinco tabelas e recria tudo do zero — contas, sessões, biblioteca e logs
> somem. Por isso este bloco vem antes dos outros que dependem do banco. Logo
> depois dele, rode o seed de novo:
>
> ```bash
> cd /home/varik/S_COM/backend && NODE_ENV=development npm run seed
> ```
>
> Os arquivos em `armazenamento/` não são apagados e ficam órfãos; podem sair
> com `rm /home/varik/S_COM/armazenamento/*`.

**Deve aparecer:** cinco `DROP TABLE`, depois os `CREATE TABLE` e `CREATE INDEX`,
um `INSERT 0 2` (os dois perfis) e **nenhum** `ERROR`.

Vale também mostrar o banco pronto:

```bash
psql -h localhost -U freevertio -d freevertio -c '\d conversao'
```

**Print:** as duas saídas. A segunda comprova chaves, tipos e índices de uma vez.

---

## 4. Testes de segurança

> Evidência obrigatória 4. Métrica C2, 2 pontos por teste, máximo 10.

São cinco. Printe o comando **e** a resposta em cada um — o avaliador precisa ver
os dois.

### 4.1 Injeção de SQL

Tentativa de entrar com a carga clássica no campo de e-mail:

```bash
curl -i -b $JAR -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -d '{"email":"admin@freevertio.local'"'"' OR 1=1 --","senha":"qualquer"}' \
  http://localhost:3000/api/sessao
```

**Deve aparecer:** `400` e `ENTRADA_INVALIDA`. A carga nem chega ao banco: a
validação de e-mail a recusa antes. Essa é a primeira camada.

A segunda camada são as consultas parametrizadas. Para mostrá-la:

```bash
cd backend && node --test testes/injecao.test.js 2>&1 | tail -8
```

**Deve aparecer:** `pass 21`.

**Print:** os dois. Juntos eles contam a história completa — a carga é recusada
na entrada, e se chegasse ao banco iria como valor, nunca como comando.

### 4.2 XSS refletido

```bash
curl -i "http://localhost:3000/api/%3Cscript%3Ealert(1)%3C%2Fscript%3E"
```

**Deve aparecer:** `404`, com estes cabeçalhos na resposta:

```
Content-Type: application/json; charset=utf-8
X-Content-Type-Options: nosniff
```

e o corpo `{"erro":{"codigo":"ROTA_NAO_ENCONTRADA","mensagem":"Nao existe GET /<script>alert(1)</script>."}}`

**O ponto a explicar no relatório:** a carga volta, sim. Isso não é falha. Ela
volta como *valor* de uma propriedade JSON, e nenhum navegador executa valor de
JSON. O que a tornaria perigosa seria o corpo ser `text/html` — e o `nosniff`
impede até a tentativa de adivinhar.

**Print:** a resposta inteira, com os cabeçalhos. É por isso que o `-i` está ali.

### 4.3 XSS armazenado

Entre no site com a conta de usuário, vá em Minha biblioteca e renomeie um
arquivo para:

```
<script>alert('xss')</script>.pdf
```

**Deve aparecer:** o item volta chamado **`script.pdf`**. A sanitização remove
`<` e `>` — sem eles não existe tag — e corta tudo antes da última barra.

**Print:** a caixa de renomear com a carga digitada, e a lista depois, com o nome
limpo.

Isso prova a primeira camada. A segunda — o que aconteceria se um nome malicioso
chegasse mesmo assim à tela — está documentada na captura
`2-imagens/xss_biblioteca.png`, feita com a API simulada: o nome aparece como
texto literal, porque a interface escreve tudo com `textContent`.

### 4.4 Acesso sem login

```bash
curl -i http://localhost:3000/api/biblioteca
```

**Deve aparecer:** `401` e `NAO_AUTENTICADO`.

### 4.5 Acesso com perfil insuficiente

Entre como usuário comum e tente a área administrativa:

```bash
JAR2=/tmp/jar_usuario.txt; rm -f $JAR2
T2=$(curl -s -c $JAR2 http://localhost:3000/api/csrf \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")

curl -s -b $JAR2 -c $JAR2 -H "Content-Type: application/json" -H "X-CSRF-Token: $T2" \
  -d '{"email":"usuario@freevertio.local","senha":"UsuarioTeste123"}' \
  http://localhost:3000/api/sessao

curl -i -b $JAR2 http://localhost:3000/api/admin/usuarios
```

**Deve aparecer:** o login responde com os dados do usuário, e a segunda
requisição responde `403` e `SEM_PERMISSAO`.

### 4.6 Token de outra sessão (CSRF)

Sem token nenhum:

```bash
curl -i -b $JAR2 -X DELETE http://localhost:3000/api/sessao
```

**Deve aparecer:** `403` e `CSRF_INVALIDO`.

Com o token da **outra** sessão — este é o teste que importa, porque mostra que
não basta ter *um* token válido:

```bash
curl -i -b $JAR2 -H "X-CSRF-Token: $TOKEN" -X DELETE http://localhost:3000/api/sessao
```

**Deve aparecer:** `403` de novo. O token do `$JAR` não serve para a sessão do
`$JAR2`.

### 4.7 Opcional, mas vale a pena: IDOR

Entre com as duas contas em jarras diferentes, guarde um arquivo com uma delas e
peça o item pelo id com a outra:

```bash
curl -i -b $JAR2 http://localhost:3000/api/biblioteca/1
```

**Deve aparecer:** `404`, e não `403`. O 404 é deliberado: um 403 confirmaria que
o item existe.

---

## 5. Amostra dos logs

> Evidência obrigatória 5. Requisito 10 exige quatro eventos, todos com timestamp.

Os logs saem no Terminal 1. Produza os quatro eventos na ordem abaixo e depois
printe o terminal inteiro de uma vez.

**Criação de conta** (`conta_criada`) — pelo site, em Criar conta, ou:

```bash
curl -s -b $JAR -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -d '{"nome":"Teste Evidencia","email":"evidencia@exemplo.com","senha":"SenhaTeste123"}' \
  http://localhost:3000/api/contas
```

> **A ordem importa.** O login bem-sucedido troca a sessão — é a proteção
> contra fixação de sessão — e o token CSRF pertence à sessão. Por isso a falha
> vem **antes** do sucesso: depois do login, o `$TOKEN` antigo não serve mais, e
> uma tentativa com ele voltaria `403 CSRF_INVALIDO` em vez de registrar a falha.

**Falha de autenticação** (`login_falha`):

```bash
curl -s -b $JAR -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -d '{"email":"evidencia@exemplo.com","senha":"senha_errada"}' \
  http://localhost:3000/api/sessao; echo
```

**Login bem-sucedido** (`login_sucesso`). O `-c $JAR` grava o cookie da sessão
nova, que o passo seguinte precisa:

```bash
curl -s -b $JAR -c $JAR -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -d '{"email":"evidencia@exemplo.com","senha":"SenhaTeste123"}' \
  http://localhost:3000/api/sessao; echo
```

**Erro interno** (`erro_interno`) — este precisa de um defeito de verdade. A forma
mais limpa é renomear uma tabela por um instante, fazer uma requisição e desfazer:

```bash
psql -h localhost -U freevertio -d freevertio -c 'ALTER TABLE conversao RENAME TO conversao_x;'
curl -i -b $JAR http://localhost:3000/api/biblioteca
psql -h localhost -U freevertio -d freevertio -c 'ALTER TABLE conversao_x RENAME TO conversao;'
```

**Deve aparecer:** a resposta é `500` com `ERRO_INTERNO` e a mensagem genérica
"Ocorreu um erro interno. Tente novamente." — e no log, a linha de nível `ERRO`
com o detalhe técnico. Esse contraste é o requisito 7 em ação: o usuário recebe
uma mensagem inútil para quem está sondando, o detalhe fica no log.

Confira que a tabela voltou:

```bash
psql -h localhost -U freevertio -d freevertio -c '\dt'
```

**Print:** o Terminal 1 mostrando as linhas de `servidor_iniciado`,
`conta_criada`, `login_sucesso`, `login_falha`, `acesso_negado` e `erro_interno`.
Se não couber em um print, dois.

---

## 6. Capturas da interface

Para o corpo do relatório, não para os anexos. Com o servidor rodando, em
`http://localhost:3000`:

1. **Página inicial com o consentimento** — escolha um arquivo e um formato que
   só o servidor faz (PNG → PDF). A caixa "Entendo e autorizo o envio" aparece.
   É a decisão de projeto mais importante do trabalho; o print sustenta o texto.
2. **Biblioteca com arquivos reais** — os cinco que você já converteu servem.
   Mostra o selo de origem, a paginação e os três botões.
3. **Área administrativa** — as estatísticas, a tabela de contas e a tabela de
   registros com o filtro de nível.
4. **Menu em dois estados** — deslogado e logado como admin, para mostrar que a
   barra reflete a sessão.

---

## 7. Lighthouse — opcional

O enunciado do TI2 não pede. Mas os relatórios em `lighthouse/` medem o site do
TI1, que não existe mais. Se a Seção 12 for citar desempenho, meça de novo:

```bash
cd /home/varik/S_COM
npx lighthouse http://localhost:3000 --output html \
  --output-path lighthouse/index-ti2.report.html \
  --only-categories=performance,accessibility,best-practices,seo
```

Biblioteca e administração redirecionam sem sessão, então medi-las mede a tela de
login — não adianta.

---

## Ordem sugerida

1 e 2 são rápidos e não tocam no banco. O 3 **zera o banco**, então faça-o antes
de tudo o que depende de dados, e rode o seed logo em seguida. Depois o bloco 4
inteiro, que é o que vale mais ponto. O 5 por último, porque os comandos dos
blocos anteriores já terão enchido o log de eventos — o que ajuda, não atrapalha.
O 6 também depois do 3: a biblioteca precisa de arquivos guardados depois que o
banco foi recriado.
