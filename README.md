# Freevertio

Conversor de arquivos com conversão no navegador, conversão no servidor, contas de usuário e biblioteca pessoal.

Projeto das disciplinas de Sistemas Computacionais (SCOM) — Engenharia de Controle e Automação, Unesp/ICT Sorocaba. O Trabalho Individual I entregou o front-end; o Trabalho Individual II acrescentou o servidor, o banco de dados, a autenticação e a biblioteca.

## A ideia

O que o navegador consegue converter sozinho, ele converte sozinho: o arquivo não sai do computador. O que ele não alcança — PDF e documentos do Office — vai para o servidor, **com autorização explícita a cada conversão**. Guardar o resultado na biblioteca é uma segunda decisão, independente da primeira: é possível converter no servidor sem guardar nada, e os dois consentimentos aparecem como duas caixas separadas, nunca como uma só.

Converter não exige cadastro. A conta serve apenas para guardar arquivos.

## Requisitos

- **Node.js 18.17 ou mais recente** (desenvolvido em 24)
- **PostgreSQL 14 ou mais recente**
- Opcionais, cada um habilita um grupo de conversões no servidor:
  - `poppler-utils` — PDF para imagem e PDF para texto
  - `img2pdf` — imagem para PDF
  - LibreOffice (`soffice`) — DOCX, XLSX, PPTX, ODT e ODS para PDF

As ferramentas opcionais são detectadas na subida do servidor. O que não estiver instalado simplesmente não aparece na lista de formatos — nada quebra.

```bash
sudo apt install poppler-utils img2pdf libreoffice      # Ubuntu/Debian
```

## Instalação

```bash
git clone https://github.com/fernando-nishio/SCOM_PROJETO.git
cd SCOM_PROJETO
```

**1. Banco de dados.** Crie o usuário e o banco, e aplique o esquema:

```bash
sudo -u postgres psql -c "CREATE USER freevertio WITH PASSWORD 'escolha_uma_senha';"
sudo -u postgres psql -c "CREATE DATABASE freevertio OWNER freevertio;"
psql -h localhost -U freevertio -d freevertio -f sql/schema.sql
```

O `schema.sql` é idempotente: rodar de novo não apaga nada e não dá erro.

**2. Configuração.**

```bash
cd backend
cp .env.example .env
```

Abra o `.env` e preencha `PGPASSWORD` com a senha que você escolheu e `SESSAO_SEGREDO` com um valor aleatório de pelo menos 32 caracteres:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

O servidor se recusa a subir com um segredo curto — melhor falhar na subida do que assinar cookies de sessão com um valor adivinhável. O `.env` está no `.gitignore` e nunca é versionado.

**3. Dependências e execução.**

```bash
npm install
npm run dev        # recarrega a cada alteração
# npm start        # sem recarga, para uso normal
```

Acesse **http://localhost:3000**. O próprio servidor Node entrega o front-end; não é preciso um segundo servidor.

> O site **não abre mais por duplo clique no `index.html`**. O front-end passou a usar módulos ES e a conversar com a API, e o protocolo `file://` bloqueia as duas coisas. Esta é uma mudança deliberada em relação ao Trabalho Individual I, cujo requisito não-funcional RNF02 previa abertura direta do arquivo.

**4. Contas de desenvolvimento (opcional).**

```bash
NODE_ENV=development npm run seed
```

Cria duas contas para teste — `admin@freevertio.local` / `AdminTeste123` e `usuario@freevertio.local` / `UsuarioTeste123`. Não são credenciais da aplicação: o script verifica `NODE_ENV` e **se recusa a rodar fora de desenvolvimento**, justamente para que estas contas nunca existam em um ambiente real.

**5. Testes.**

```bash
npm test           # de dentro de backend/
```

Os testes não precisam de banco, de rede nem das ferramentas externas: cobrem as regras puras — validação de entrada, assinaturas de formato, fila de concorrência, token CSRF, autorização por perfil e consultas parametrizadas.

## O que ele converte

**No navegador, sem enviar nada:**

| Entrada | Saídas |
|---|---|
| JPG / JPEG | PNG, WEBP |
| PNG | JPG, WEBP |
| WEBP | JPG, PNG |
| CSV | JSON |
| JSON | CSV |
| TXT | TXT em maiúsculas |

**No servidor, com autorização:**

| De | Para | Ferramenta |
|---|---|---|
| JPG, PNG, WEBP, AVIF, TIFF, GIF | entre si | sharp |
| JPG, PNG, WEBP, AVIF, TIFF, GIF | PDF | img2pdf |
| PDF | PNG, JPG | pdftoppm (primeira página, 150 dpi) |
| PDF | TXT | pdftotext |
| DOCX, XLSX, PPTX, ODT, ODS | PDF | LibreOffice headless |

O formato é verificado pelos **bytes iniciais do arquivo**, não pela extensão: um executável renomeado para `.png` é recusado antes de qualquer conversão.

Arquivos enviados ao servidor são convertidos em um diretório temporário e apagados em seguida — a não ser que você peça para guardar.

## Conta, biblioteca e administração

Com uma conta, cada conversão pode ser guardada na biblioteca, de onde pode ser baixada, renomeada ou apagada. Cada item registra onde foi convertido, no navegador ou no servidor.

Um item só é encontrado pelo seu dono: o identificador do usuário entra na cláusula `WHERE` como condição de busca, e não como verificação posterior. Pedir o arquivo de outra pessoa devolve 404, que não confirma nem desmente a existência do item.

O perfil `admin` tem acesso a estatísticas de uso, à lista de contas e ao registro de eventos. O servidor verifica o perfil em toda requisição; a interface apenas reflete o que o servidor já decidiu.

## Segurança

| Medida | Onde |
|---|---|
| Senhas com bcrypt, custo 12 | `servicos/autenticacao.js` |
| Mesma mensagem e mesmo tempo para e-mail inexistente e senha errada | `servicos/autenticacao.js` |
| `session.regenerate()` no login, contra fixação de sessão | `rotas/autenticacao.js` |
| Cookie `HttpOnly`, `SameSite=Strict` e `Secure` fora de desenvolvimento | `servidor.js` |
| Token CSRF por sessão, comparado em tempo constante | `middlewares/csrf.js` |
| Autorização como condição de busca, contra IDOR | `dados/conversao-repo.js` |
| Apenas SQL parametrizado, em todo o diretório `dados/` | `dados/` |
| Validação de entrada antes do banco, constraints do schema como segunda linha | `util/validacao.js`, `sql/schema.sql` |
| Tipo de arquivo verificado por assinatura binária | `util/formatos.js` |
| `execFile` com argumentos em array — nenhum comando passa por um shell | `servicos/conversao.js` |
| Nomes de arquivo em UUID no disco, fora do diretório servido como estático | `servicos/armazenamento.js` |
| Download com `Content-Disposition: attachment` e `nosniff` | `rotas/biblioteca.js` |
| Limite de taxa, com as tentativas bem-sucedidas descontadas | `middlewares/limites.js` |
| Cabeçalhos de segurança e CSP (helmet) | `servidor.js` |
| Fila com concorrência limitada: carga excessiva devolve 503, não derruba o servidor | `servicos/fila.js` |

## Estrutura

```
SCOM_PROJETO/
├── sql/schema.sql           perfil, usuario, sessao, conversao, log_evento
├── backend/
│   ├── src/
│   │   ├── config/          único módulo que lê o ambiente
│   │   ├── dados/           única camada com SQL
│   │   ├── servicos/        regra de negócio, não conhece HTTP
│   │   ├── rotas/           só HTTP: lê a requisição, chama o serviço
│   │   ├── middlewares/     sessão, CSRF, upload, limites, erros
│   │   ├── util/            validação, formatos, erros, log
│   │   └── servidor.js      montagem da aplicação
│   ├── scripts/seed.js      contas de desenvolvimento
│   └── testes/              node --test, sem banco
├── frontend/
│   ├── index.html           conversor
│   ├── sobre.html           sobre o projeto
│   ├── login.html           entrar
│   ├── cria_login.html      criar conta
│   ├── biblioteca.html      arquivos guardados
│   ├── admin.html           área administrativa
│   ├── css/                 style.css (TI1) + componentes.css (TI2, aditivo)
│   ├── js/                  api.js, sessao-ui.js e um módulo por página
│   └── img/
├── docs/                    arquitetura, permissões, API, declaração de IA
└── armazenamento/           arquivos da biblioteca (fora do estático, não versionado)
```

## Documentação

- `docs/arquitetura.md` — as três camadas e por que o SQL fica em uma só
- `docs/permissoes.md` — autenticação, autorização e por que 404 em vez de 403
- `docs/api.md` — todas as rotas, com exemplos em `curl`
- `docs/declaracao-ia-ti2.md` — uso de IA generativa no Trabalho Individual II

## Limitações conhecidas

- A conversão de PDF para imagem usa apenas a primeira página.
- A conversão no navegador processa o arquivo inteiro em memória, na thread principal: arquivos grandes travam a interface enquanto convertem.
- Upload limitado a 20 MB, configurável no `.env`.
- Não há recuperação de senha nem confirmação de e-mail.
- A retenção automática de arquivos vencidos existe no banco (`expira_em`) mas não há rotina agendada que a execute.
- Áudio e vídeo estão fora do escopo.

## Navegadores testados

Google Chrome 153, Mozilla Firefox 151 e Microsoft Edge 153, em Ubuntu 22.04.5 LTS.

## Uso de IA generativa

No Trabalho Individual I, o HTML e o CSS foram escritos integralmente pelo autor, com uso de IA generativa para esclarecimento de dúvidas, sugestões de estilo e correção de defeitos em código já escrito.

No Trabalho Individual II houve uso mais extenso, incluindo geração de código. A declaração completa — ferramenta, finalidade, trecho produzido e modificações realizadas — está em `docs/declaracao-ia-ti2.md` e na seção correspondente de cada relatório.

## Autor

Fernando Seiji Amaral Nishio
