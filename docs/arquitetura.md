# Arquitetura do sistema

## Padrão adotado

Arquitetura em **três camadas**, com o frontend separado do backend e o acesso
a dados isolado numa camada própria.

```
navegador                          servidor Node
┌──────────────────┐   HTTP/JSON   ┌──────────────────────────────────┐
│  frontend/       │ ◄───────────► │  rotas/      (interface HTTP)    │
│  HTML, CSS, JS   │               │      ↓                           │
│  conversão local │               │  servicos/   (regra de negócio)  │
└──────────────────┘               │      ↓                           │
                                   │  dados/      (acesso ao banco)   │
                                   └──────────────┬───────────────────┘
                                                  │ SQL parametrizado
                                            ┌─────▼──────┐
                                            │ PostgreSQL │
                                            └────────────┘
```

## A regra de dependência

**Cada camada só conhece a de baixo.** As setas do diagrama apontam numa
direção só, e isso é verificável:

| Camada | Pode usar | Nunca pode |
|---|---|---|
| `rotas/` | `servicos/` | escrever SQL, tocar o disco |
| `servicos/` | `dados/`, utilitários | ver `req` ou `res` |
| `dados/` | `pool.js` | conhecer regra de negócio |

A segunda linha é a mais importante e a mais fácil de violar. Um serviço que
recebe `req` deixa de ser testável sem subir um servidor HTTP — e os cinco
testes automatizados exigidos passam a depender de infraestrutura que não
deveriam precisar.

Duas conferências rápidas antes de cada entrega:

```bash
# nenhuma rota ou servico deve conter SQL
grep -rn "pool.query\|SELECT \|INSERT \|UPDATE \|DELETE " src/rotas/ src/servicos/

# nenhum servico deve conhecer HTTP
grep -rn "req\.\|res\.\|next(" src/servicos/
```

Se as duas não imprimirem nada, as camadas estão honestas.

## Onde a conversão acontece

O sistema converte arquivos em dois lugares, e isso é decisão de projeto, não
acidente de implementação.

| | Converte onde | O arquivo sai da máquina? |
|---|---|---|
| JPG, PNG, WEBP, CSV, JSON, TXT | navegador | **não** |
| PDF, DOCX, XLSX e demais | servidor | sim, com autorização explícita |

O Trabalho I sustentou que a conversão desses primeiros formatos não exige
servidor, e isso continua verdadeiro. O backend não substitui aquela
implementação: ele atende os formatos que o navegador comprovadamente não
alcança — exatamente os que a Seção 12 daquele relatório listou como fora do
escopo.

Duas consequências:

- **o servidor pode cair sem derrubar o produto.** Sem backend, a conversão
  local continua funcionando; o que se perde é a biblioteca e os formatos
  novos. A interface informa isso em vez de quebrar.
- **toda conversão local é carga zero para o servidor.** A decisão foi tomada
  por privacidade, mas o efeito em desempenho é real e está medido na Seção 12
  do relatório.

## Fluxo de uma requisição

`POST /api/conversoes` (conversão no servidor), do primeiro ao último passo:

| # | Onde | O que acontece |
|---|---|---|
| 1 | `middlewares/rateLimit` | a origem excedeu a cota? → `429` |
| 2 | `middlewares/upload` | multer grava em disco temporário com nome UUID |
| 3 | `rotas/conversoes` | lê os campos, chama o serviço |
| 4 | `servicos/conversao` | valida tamanho, tipo real (*magic bytes*) e par de formatos |
| 5 | `servicos/fila` | aguarda vaga; recusa com `503` se a fila estiver cheia |
| 6 | `servicos/conversao` | `execFile` do conversor externo, com timeout |
| 7 | `dados/conversaoRepo` | grava a linha, **se** o usuário pediu para guardar |
| 8 | `rotas/conversoes` | devolve o arquivo como `attachment` |
| 9 | `finally` | apaga os temporários, inclusive em caso de erro |

O passo 9 num `finally` não é detalhe: sem ele, cada conversão que falha deixa
lixo permanente no disco.

## Configuração

Nenhum valor de ambiente aparece no código. `config/index.js` é o único módulo
que lê `process.env`, e todo o resto importa dele.

```
.env            valores reais        — NÃO versionado
.env.example    estrutura e exemplos — versionado
```

`.env` está no `.gitignore` desde o primeiro commit do backend. Credencial que
entra no histórico do Git não sai com um `rm`.

## Armazenamento dos arquivos

Os arquivos ficam em `armazenamento/`, **fora do diretório servido como
estático**, com o nome em UUID. O banco guarda apenas a referência.

Isso é segurança, não organização. Se os arquivos estivessem dentro de
`frontend/`, o servidor de estáticos os entregaria por URL direta, passando por
cima do login, da verificação de propriedade e dos cabeçalhos de download.
Fora dali, o único caminho até um arquivo é uma rota que faz as três coisas.

O nome em UUID resolve outras duas: *path traversal* (um nome como
`../../etc/passwd` nunca toca o sistema de arquivos) e colisão entre arquivos
de mesmo nome de usuários diferentes.

## Tratamento de erros

Um único middleware, registrado por último, captura tudo. As rotas não montam
resposta de erro — lançam, e ele formata:

```json
{ "erro": { "codigo": "ARQUIVO_GRANDE_DEMAIS",
            "mensagem": "O arquivo excede o limite de 20 MB." } }
```

Detalhes técnicos e *stack trace* só entram na resposta quando
`NODE_ENV === "development"`. Em produção eles vão para o log, nunca para o
cliente: mensagem de erro detalhada é reconhecimento gratuito para quem está
sondando o sistema.

## Convenções de nomenclatura

| Elemento | Convenção | Exemplo |
|---|---|---|
| arquivos e diretórios | minúsculo, `kebab-case` | `conversao-repo.js` |
| tabelas e colunas | `snake_case`, singular | `log_evento`, `criado_em` |
| variáveis e funções JS | `camelCase`, português | `listarConversoes` |
| constantes | `MAIUSCULO_COM_UNDERLINE` | `LIMITE_CONCORRENCIA` |
| rotas da API | plural, substantivo | `/api/conversoes` |
| códigos de erro | `MAIUSCULO_COM_UNDERLINE` | `SESSAO_EXPIRADA` |

Módulos em **ESM** (`import`/`export`) no projeto inteiro, com
`"type": "module"` no `package.json`. Nenhum módulo depende de variável global.

**Exceção única:** a tabela `sessao` tem as colunas `sid`, `sess` e `expire` em
inglês, porque os nomes são impostos pela biblioteca `connect-pg-simple`.

## Decisões registradas

| Decisão | Alternativa descartada | Por quê |
|---|---|---|
| Sessão em cookie | JWT | logout real exige invalidar no servidor; com JWT seria preciso manter lista de revogação |
| Arquivo em disco | `BYTEA` no banco | mantém o banco leve e os dumps utilizáveis |
| Tabela `perfil` | `CHECK` na coluna | perfil novo vira `INSERT`, não alteração de schema |
| `ON DELETE SET NULL` nos logs | `CASCADE` | apagar conta não pode apagar rastro de auditoria |
| Fila com limite de concorrência | atender tudo em paralelo | processos de conversão esgotam RAM e derrubam o servidor |
| Conversão local por padrão | tudo no servidor | preserva a premissa do Trabalho I e zera o custo do caso comum |
