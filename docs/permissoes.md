# Matriz de permissões

O Freevertio tem três níveis de acesso. Dois deles são perfis persistidos na
tabela `perfil`; o terceiro é a ausência de sessão.

| Nível | Como se obtém | Persistido no banco |
|---|---|---|
| **anônimo** | não ter sessão ativa | não — é a ausência de sessão |
| **usuario** | criar conta (padrão) | sim, `perfil = 'usuario'` |
| **admin** | definido diretamente no banco | sim, `perfil = 'admin'` |

O nível anônimo não é uma lacuna de projeto: é a continuidade da decisão
tomada no Trabalho I de que **a conversão não exige cadastro**. Quem só quer
converter um arquivo continua podendo, sem conta.

Não há tela de promoção a administrador. Um administrador é criado por quem
tem acesso ao banco — por `sql/seed.js` em desenvolvimento, ou por um `UPDATE`
manual. Expor essa operação pela aplicação criaria uma rota de escalada de
privilégio sem benefício nenhum para o domínio.

## A matriz

| Ação | anônimo | usuario | admin |
|---|:---:|:---:|:---:|
| Converter no navegador (local) | ✔ | ✔ | ✔ |
| Converter no servidor | ✔ | ✔ | ✔ |
| Criar conta | ✔ | — | — |
| Entrar / sair | ✔ | ✔ | ✔ |
| Guardar arquivo na biblioteca | ✘ | ✔ | ✔ |
| Listar a **própria** biblioteca | ✘ | ✔ | ✔ |
| Baixar arquivo **próprio** | ✘ | ✔ | ✔ |
| Renomear item **próprio** | ✘ | ✔ | ✔ |
| Apagar item **próprio** | ✘ | ✔ | ✔ |
| Listar biblioteca **de outro usuário** | ✘ | ✘ | ✔ |
| Apagar item **de outro usuário** | ✘ | ✘ | ✔ |
| Listar contas de usuário | ✘ | ✘ | ✔ |
| Ativar / desativar conta | ✘ | ✘ | ✔ |
| Consultar os logs do sistema | ✘ | ✘ | ✔ |
| Ver estatísticas de uso | ✘ | ✘ | ✔ |

✔ permitido  ✘ negado  — não se aplica

## Duas verificações, não uma

Cada linha com a palavra **próprio** depende de duas checagens independentes,
e confundi-las é a falha de controle de acesso mais comum em aplicações web:

1. **Autenticação** — existe uma sessão válida?
2. **Autorização** — esta sessão pode agir sobre *este registro*?

Proteger só a rota resolve (1) e deixa (2) em aberto. Um usuário autenticado
que pede `GET /api/biblioteca/42` passaria pela primeira verificação mesmo que
o item 42 pertença a outra pessoa. Essa falha tem nome: **IDOR** (*Insecure
Direct Object Reference*).

A defesa não é um `if` antes da consulta — é fazer o dono **fazer parte da
consulta**:

```sql
-- vulneravel: autentica, mas nao autoriza
SELECT * FROM conversao WHERE id = $1;

-- correto: o dono e condicao de busca
SELECT * FROM conversao WHERE id = $1 AND usuario_id = $2;
```

Com a segunda forma, pedir o item de outro usuário devolve zero linhas, e a
aplicação responde `404`. Responder `404` e não `403` é deliberado: `403`
confirmaria que o item existe, o que já é informação a mais para quem está
sondando.

O administrador usa um caminho de consulta diferente, sem o filtro de dono —
nunca a mesma função com uma flag. Separar as consultas impede que um descuido
em uma condicional vire acesso irrestrito.

## Onde cada regra é aplicada

| Camada | Responsabilidade |
|---|---|
| `middlewares/exigirLogin.js` | rejeita quem não tem sessão → `401` |
| `middlewares/exigirPerfil.js` | rejeita perfil insuficiente → `403` |
| `servicos/` | aplica a regra de propriedade do registro |
| `dados/` | a condição `usuario_id = $2` nas consultas |

A verificação de propriedade mora no serviço e na consulta, **não na rota**.
Assim ela vale para qualquer caminho que chegue àquela operação, inclusive um
criado depois que alguém esqueceu de repetir a checagem.

## Testes de controle de acesso

Estes casos estão entre os testes de segurança documentados na Seção 10 do
relatório:

| # | Cenário | Esperado |
|---|---|---|
| 1 | `GET /api/biblioteca` sem sessão | `401` |
| 2 | usuário A pede item de B por id | `404` |
| 3 | usuário comum em `GET /api/admin/usuarios` | `403` |
| 4 | usuário A tenta `DELETE` em item de B | `404`, item intacto |
| 5 | requisição com cookie de sessão já encerrada | `401` |
