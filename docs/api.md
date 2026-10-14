# API do Freevertio

Base: `http://localhost:3000/api`

Todas as respostas são JSON, exceto downloads de arquivo.

## Formato das respostas

Sucesso devolve o recurso diretamente. Erro devolve sempre esta forma:

```json
{ "erro": { "codigo": "ENTRADA_INVALIDA",
            "mensagem": "Informe um e-mail valido." } }
```

O `codigo` é estável e serve para o cliente decidir o que fazer; a
`mensagem` é escrita para ser mostrada ao usuário. Em `NODE_ENV=development`
a resposta traz também `detalhes` e, para defeitos, `excecao` e `pilha` —
nunca em produção.

### Códigos de erro

| Código | Status | Quando |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | campo ausente, malformado ou fora dos limites |
| `JSON_INVALIDO` | 400 | corpo não é JSON válido |
| `NAO_AUTENTICADO` | 401 | rota exige sessão e não há |
| `SESSAO_EXPIRADA` | 401 | sessão aponta para usuário inexistente |
| `SEM_PERMISSAO` | 403 | perfil insuficiente, ou conta desativada |
| `NAO_ENCONTRADO` | 404 | recurso inexistente **ou de outro usuário** |
| `ROTA_NAO_ENCONTRADA` | 404 | método/caminho não existe |
| `CONFLITO` / `JA_EXISTE` | 409 | e-mail já cadastrado |
| `ARQUIVO_GRANDE_DEMAIS` | 413 | upload acima do limite |
| `FORMATO_NAO_SUPORTADO` | 415 | conversão não oferecida |
| `FALHA_CONVERSAO` | 422 | arquivo íntegro mas conversão falhou |
| `MUITAS_TENTATIVAS` | 429 | limite de taxa excedido |
| `ERRO_INTERNO` | 500 | defeito — detalhes só no log |
| `SERVIDOR_OCUPADO` | 503 | fila de conversão cheia |
| `BANCO_INDISPONIVEL` | 503 | sem conexão com o PostgreSQL |

## Autenticação

Sessão em cookie `freevertio.sid`, com `httpOnly`, `SameSite=Strict` e
`Secure` em produção. O cliente não manipula o cookie — basta usar
`credentials: "same-origin"` no `fetch`.

---

## `GET /saude`

Diagnóstico. Pública e fora do limite de taxa.

**200**
```json
{ "estado": "ok", "banco": "ok", "tempoRespostaMs": 2, "tempoNoArMs": 81234 }
```

**503** — mesma forma, com `"estado": "degradado"` e `"banco": "indisponivel"`.

---

## `POST /contas`

Cadastra um usuário. Sempre com perfil `usuario`.

Limite: 10 tentativas falhas por IP a cada 15 min.

**Requisição**
```json
{ "nome": "Fernando Nishio",
  "email": "fernando@exemplo.com",
  "senha": "umaSenhaBoa123" }
```

| Campo | Regras |
|---|---|
| `nome` | 2 a 120 caracteres, espaços das bordas removidos |
| `email` | formato válido, até 255, normalizado para minúsculas |
| `senha` | mínimo 8 caracteres, máximo 72 **bytes** |

**201**
```json
{ "usuario": { "id": 3, "nome": "Fernando Nishio",
               "email": "fernando@exemplo.com", "perfil": "usuario" } }
```

Status possíveis: `201`, `400`, `409`, `429`.

---

## `POST /sessao`

Login. Cria a sessão e devolve o cookie.

Limite: 10 tentativas falhas por IP a cada 15 min. Tentativas bem-sucedidas
não contam.

**Requisição**
```json
{ "email": "fernando@exemplo.com", "senha": "umaSenhaBoa123" }
```

**200**
```json
{ "usuario": { "id": 3, "nome": "Fernando Nishio",
               "email": "fernando@exemplo.com", "perfil": "usuario" } }
```

**400** — `ENTRADA_INVALIDA`, mensagem `"E-mail ou senha incorretos."`

A mensagem é **idêntica** para e-mail inexistente e senha errada, e as duas
levam o mesmo tempo para responder. Mensagens ou tempos diferentes
transformariam a tela de login num verificador de cadastro.

**403** — conta desativada. Aqui a senha já foi confirmada, então não há o
que proteger e o usuário precisa saber por que não entra.

Status possíveis: `200`, `400`, `403`, `429`.

---

## `GET /sessao`

Quem está logado. Usada pela barra de navegação. Não exige sessão: a
ausência dela é uma resposta válida.

**200, anônimo**
```json
{ "autenticado": false, "usuario": null }
```

**200, autenticado**
```json
{ "autenticado": true,
  "usuario": { "id": 3, "nome": "Fernando Nishio",
               "email": "fernando@exemplo.com", "perfil": "usuario" } }
```

---

## `DELETE /sessao`

Logout. Exige sessão ativa.

**204** — sem corpo.

A sessão é removida da tabela `sessao`, não apenas esquecida pelo navegador:
um cookie copiado antes do logout deixa de funcionar imediatamente.

Status possíveis: `204`, `401`.

---

## Biblioteca

Todas as rotas abaixo exigem sessão. A verificação de **propriedade** acontece
na cláusula `WHERE` das consultas: pedir um item de outro usuário devolve
`404`, não `403` — `403` confirmaria que o item existe.

### `POST /biblioteca`

Guarda um arquivo já convertido. É a rota de upload cru: o servidor nunca viu
esse arquivo antes, então o conteúdo é validado pelos *magic bytes*, não pela
extensão.

**Requisição** — `multipart/form-data`

| Campo | Tipo | Descrição |
|---|---|---|
| `arquivo` | file | o arquivo convertido, até 20 MB |
| `formatoOrigem` | texto | formato de entrada (`png`, `csv`, …) |
| `formatoDestino` | texto | formato do arquivo enviado |
| `origemConversao` | texto | `local` ou `servidor` |

```bash
curl -X POST localhost:3000/api/biblioteca -b cookies.txt \
  -F arquivo=@convertido.png \
  -F formatoOrigem=jpg -F formatoDestino=png -F origemConversao=local
```

**201**
```json
{ "item": { "id": 1, "nome": "convertido.png",
            "formatoOrigem": "jpg", "formatoDestino": "png",
            "origemConversao": "local", "tamanhoBytes": 2048,
            "criadoEm": "2026-10-13T14:02:11.483Z", "expiraEm": null } }
```

O campo `origemConversao` é registrado para que a biblioteca mostre, item a
item, se aquele arquivo foi convertido na máquina do usuário ou no servidor.

Status possíveis: `201`, `400`, `401`, `413`, `415`.

### `GET /biblioteca?pagina=1&porPagina=20`

Lista a biblioteca do usuário, mais recentes primeiro. `porPagina` é limitado
a 100.

**200**
```json
{ "itens": [ /* … */ ],
  "paginacao": { "pagina": 1, "porPagina": 20, "total": 37, "totalPaginas": 2 } }
```

### `GET /biblioteca/:id/arquivo`

Baixa um item próprio.

Responde com `Content-Type: application/octet-stream`,
`Content-Disposition: attachment` e `X-Content-Type-Options: nosniff`. Os três
juntos impedem que um arquivo enviado por um usuário seja interpretado como
HTML pelo navegador e execute script na origem da aplicação.

Status possíveis: `200`, `401`, `404`.

### `PATCH /biblioteca/:id`

Renomeia. `PATCH` e não `PUT` porque altera um campo, não substitui o recurso.

**Requisição**
```json
{ "nome": "foto do documento.png" }
```

A extensão do formato de destino é mantida à força, mesmo que o nome enviado
tenha outra.

Status possíveis: `200`, `400`, `401`, `404`.

### `DELETE /biblioteca/:id`

Apaga o registro e o arquivo em disco.

**204** — sem corpo.

Status possíveis: `204`, `401`, `404`.

---

## Conversão no servidor

Estas rotas atendem **anônimo e logado**. Converter não exige conta — é a
decisão do Trabalho I ("o cadastro não é obrigatório") continuando a valer. O
que exige sessão é apenas pedir para guardar o resultado.

### `GET /conversoes/formatos`

O que este servidor consegue converter, agora, com as ferramentas instaladas.

**200**
```json
{ "servidor": { "png": ["jpg", "webp", "avif", "tiff", "gif", "pdf"],
                "pdf": ["png", "jpg", "txt"],
                "docx": ["pdf"] },
  "fila": { "emExecucao": 0, "aguardando": 0,
            "concorrencia": 4, "tamanhoMaximo": 50 } }
```

O cliente pergunta ao servidor o que ele sabe fazer, em vez de a lista estar
duplicada no JavaScript da página. Instalar ou remover uma ferramenta se
reflete na interface sem alterar o front-end.

### `POST /conversoes`

Limite: 30 conversões por IP a cada 10 minutos.

**Requisição** — `multipart/form-data`

| Campo | Descrição |
|---|---|
| `arquivo` | o arquivo a converter, até 20 MB. O formato de origem vem da extensão do nome |
| `formatoDestino` | para qual formato converter |
| `guardar` | `"1"` para também guardar na biblioteca (exige sessão) |

```bash
curl -X POST localhost:3000/api/conversoes \
  -F arquivo=@foto.png -F formatoDestino=pdf -o foto.pdf
```

**200** — o arquivo convertido, como download
(`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`).

Quando `guardar=1`, o identificador do item criado vai no cabeçalho
`X-Item-Id`, para que o cliente receba o arquivo de imediato e saiba o que
entrou na biblioteca.

O conteúdo é validado pelos *magic bytes* **antes** de qualquer ferramenta
externa tocar nele.

Status possíveis: `200`, `400`, `401` (pediu `guardar` sem sessão), `413`,
`415`, `422` (conversão falhou ou estourou o tempo), `429`, `503` (fila cheia).

### Conversões oferecidas

| De | Para | Ferramenta |
|---|---|---|
| jpg, png, webp, avif, tiff, gif | entre si | sharp |
| jpg, png, webp, avif, tiff, gif | pdf | img2pdf (via sharp quando precisa normalizar) |
| pdf | png, jpg | pdftoppm (primeira página, 150 dpi) |
| pdf | txt | pdftotext |
| docx, xlsx, pptx, odt, ods | pdf | LibreOffice headless |

Ferramenta ausente não quebra o servidor: as conversões que dependem dela
simplesmente não aparecem em `GET /conversoes/formatos`.

---

## Área administrativa

Todas as rotas abaixo exigem sessão **e** perfil `admin`. As duas verificações
são aplicadas no router inteiro, não rota a rota — assim uma rota nova já
nasce protegida.

O caminho é `/api/admin/...` e não um parâmetro nas rotas existentes. Separar
os endereços separa também as consultas: as daqui não filtram por dono, e por
isso não compartilham código com as do usuário comum. Uma condicional errada
num caminho único transformaria "minha biblioteca" em "a biblioteca de todos".

### `GET /admin/usuarios?pagina=1&porPagina=50`

**200**
```json
{ "usuarios": [ { "id": 1, "nome": "Administrador de Teste",
                  "email": "admin@freevertio.local", "perfil": "admin",
                  "ativo": true, "criadoEm": "…", "totalConversoes": 4 } ],
  "paginacao": { "pagina": 1, "porPagina": 50, "total": 2, "totalPaginas": 1 } }
```

O hash da senha nunca sai do banco nesta consulta.

### `PATCH /admin/usuarios/:id`

Ativa ou desativa uma conta. Desativar, não apagar: a conta sai de uso mas o
histórico de conversões e os registros de log continuam de pé. Apagar
dispararia o `ON DELETE CASCADE` e levaria a biblioteca junto.

**Requisição**
```json
{ "ativo": false }
```

**400** quando o administrador tenta desativar a **própria** conta — sem essa
trava, um clique errado tranca o último administrador para fora do sistema.
Reativar a si mesmo continua permitido.

A ação fica registrada em `log_evento` com quem fez e em quem.

Status possíveis: `200`, `400`, `401`, `403`, `404`.

### `GET /admin/conversoes?pagina=1`

Biblioteca de todos os usuários, com o dono de cada item.

### `DELETE /admin/conversoes/:id`

Apaga item de qualquer usuário, registro e arquivo. **204**.

### `GET /admin/logs?nivel=erro&pagina=1&porPagina=100`

`nivel` é opcional e aceita `info`, `aviso` ou `erro`.

**200**
```json
{ "logs": [ { "id": 42, "ocorridoEm": "…", "nivel": "aviso",
              "evento": "login_falha", "usuario": null,
              "ip": "127.0.0.1", "detalhe": "ENTRADA_INVALIDA" } ],
  "paginacao": { "pagina": 1, "porPagina": 100 } }
```

### `GET /admin/estatisticas?desdeHoras=24`

**200**
```json
{ "usuarios": { "total": 2 },
  "conversoes": { "total": 12, "bytesTotais": 184320,
                  "convertidasLocal": 7, "convertidasServidor": 5 },
  "armazenamento": { "bytesEmDisco": 184320, "diferencaBytes": 0 },
  "fila": { "emExecucao": 0, "aguardando": 0, "concorrencia": 4, "tamanhoMaximo": 50 },
  "eventos": { "desdeHoras": 24,
               "porEvento": [ { "evento": "login_sucesso", "nivel": "info", "total": 9 } ] } }
```

O campo `diferencaBytes` compara o somatório do banco com o que há em disco.
Diferente de zero significa arquivos órfãos — resultado de uma remoção que
falhou depois de a linha já ter sido apagada.
