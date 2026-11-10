# Declaração de uso de IA generativa — Trabalho Individual II

Texto base para a Seção 13 do relatório. **Leia e ajuste cada linha antes de
entregar** — a declaração precisa descrever o que de fato aconteceu, e só você
sabe o que revisou e o que apenas aceitou.

O enunciado exige cinco colunas: ferramenta, finalidade, trecho produzido,
modificações realizadas e avaliação crítica. As quatro primeiras estão na
tabela; a quinta é o texto que vem depois dela.

---

## O que mudou em relação ao Trabalho I

No Trabalho I você declarou que **a marcação HTML e a folha de estilos foram
escritas integralmente pelo autor**, e isso era verdade.

No Trabalho II deixou de ser. O backend inteiro, o JavaScript do front-end, as
páginas novas (`biblioteca.html`, `admin.html`, `cria_login.html`) e o
`componentes.css` foram gerados por IA. A declaração precisa dizer isso com
todas as letras — uso não declarado implica nota zero, e a diferença entre os
dois trabalhos é visível para quem comparar os repositórios.

O que continua seu: as decisões de arquitetura (modelo híbrido, dois
consentimentos separados, sessão em vez de JWT, arquivo em disco em vez de
BYTEA), a execução e o teste de tudo na sua máquina, e o `style.css` original
do Trabalho I, que não foi alterado — o CSS novo veio num arquivo separado,
aditivo, usando as variáveis que você já tinha definido.

---

## Tabela

| Ferramenta | Finalidade | Trecho produzido | Modificações realizadas |
|---|---|---|---|
| Claude (Anthropic) | Projeto e implementação do backend | Schema do banco (`sql/schema.sql`), camadas `rotas/`, `servicos/`, `dados/`, middlewares de autenticação, CSRF, limite de taxa e upload, e os 72 testes automatizados | Execução e verificação de cada etapa na máquina do autor; correção do `package.json` quando a versão do `sharp` acusou vulnerabilidade; decisão sobre quais formatos de conversão oferecer |
| Claude (Anthropic) | Decisões de arquitetura | Apresentação das alternativas e das consequências de cada uma: híbrido × tudo no servidor, sessão × JWT, arquivo em disco × BYTEA, consulta separada × condicional para a área administrativa | Escolha de todas as alternativas pelo autor; o modelo híbrido e a separação dos dois consentimentos foram decididos a partir da discussão |
| Claude (Anthropic) | JavaScript do front-end | `api.js`, `sessao-ui.js`, `login.js`, `cadastro.js`, `biblioteca.js`, `admin.js` e a reescrita de `conversor.js` | Verificação de cada tela no navegador pelo autor |
| Claude (Anthropic) | Páginas e estilos novos | `biblioteca.html`, `admin.html`, `cria_login.html`, reescrita de `index.html` e `login.html`, e o arquivo `css/componentes.css` | Conferência visual e de responsividade pelo autor. O `css/style.css` do Trabalho I **não foi alterado**: o CSS novo é aditivo e reutiliza as variáveis já definidas no `:root` |
| Claude (Anthropic) | Documentação | `docs/arquitetura.md`, `docs/permissoes.md`, `docs/api.md` e este texto | Revisão pelo autor |

> Se você revisar o código a fundo e mudar trechos, atualize a coluna de
> modificações. Se não revisar, deixe como está — declarar menos participação
> do que houve é o único erro grave possível aqui.

---

## Avaliação crítica das sugestões

*(texto base; ajuste para o que você observou)*

O emprego de inteligência artificial generativa no Trabalho II foi
qualitativamente diferente do Trabalho I. Naquele, a ferramenta atuou sobre
código já escrito — apontando defeitos de contraste, rótulos ausentes e regras
CSS anuladas. Neste, ela produziu a implementação, e o papel do autor deslocou-se
da escrita para a decisão e a verificação.

A maior utilidade esteve em tornar explícitas as consequências de escolhas que
pareciam equivalentes. A decisão entre guardar o arquivo em disco ou em coluna
`BYTEA`, por exemplo, não é uma questão de preferência: a primeira mantém os
*dumps* do banco utilizáveis e exige manter dois armazenamentos em sincronia; a
segunda simplifica a exclusão e faz o banco crescer sem limite. Ter as duas
consequências enunciadas antes de escolher é diferente de descobri-las depois.

Verificou-se também que a ferramenta erra, e que os erros só aparecem na
execução. Ao longo do desenvolvimento foram registrados: um script de
populamento do banco colocado em diretório onde o Node não resolveria as
dependências; um teste de validação que dependia de qual ferramenta externa
estava instalada e falhava por motivo alheio ao que verificava; uma asserção
que contava caracteres onde deveria contar unidades UTF-16; e um arquivo de
configuração que, ao ser reenviado, desfez a correção de segurança de uma
dependência previamente aplicada. Nenhum desses defeitos foi detectado por
inspeção — todos apareceram ao executar.

Daí a conclusão que o trabalho sustenta: a verificação não é etapa posterior à
geração, é a etapa que determina se o que foi gerado serve. Os 72 testes
automatizados, a auditoria de dependências com `npm audit` e a execução de cada
rota contra o servidor real foram o que distinguiu código que funciona de
código que parece funcionar.

Por fim, cabe registrar o limite desta forma de trabalho. O autor consegue
explicar cada decisão de arquitetura e cada escolha de segurança do sistema,
porque participou delas. Não escreveu, linha a linha, a implementação que as
realiza.
