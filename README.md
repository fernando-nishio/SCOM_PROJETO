Trabalho Individual I da disciplina de Sistemas Computacionais (SCOM) — Engenharia de Controle e Automação, Unesp/Sorocaba.

## Como executar

Após fazer o download do arquivo zip ou realizar git clone basta abrir`index.html` em um navegador moderno:

```bash
git clone https://github.com/fernando-nishio/SCOM_PROJETO.git
cd freevertio
xdg-open index.html      # Linux
# open index.html        # macOS
```

Ou simplesmente dar duplo clique no `index.html`.

### Servindo por HTTP (opcional)

Para realizar o teste do lighthouse basta:

```bash
python3 -m http.server 8123
```

E acesse `http://localhost:8123`.

## O que ele converte

| Entrada | Saídas disponíveis |
|---|---|
| JPG / JPEG | PNG, WEBP |
| PNG | JPG, WEBP |
| WEBP | JPG, PNG |
| CSV | JSON |
| JSON | CSV |
| TXT | TXT em maiúsculas |

O tipo do arquivo é detectado automaticamente pela extensão, e a lista de formatos de saída mostra apenas as conversões compatíveis com o arquivo escolhido.

## Como usar

1. Escolha um arquivo no seletor da página inicial.
2. Escolha o formato de saída na lista que aparece.
3. Clique em **Iniciar conversão** e baixe o resultado.

## Telas de login

As páginas `login.html` e `cria_login.html` são **maquete de interface**, não autenticação de verdade. A validação acontece só no cliente, com um par de credenciais fixo no `js/login.js`:

```
e-mail: teste@freevertio.teste
senha:  senhateste123
```

Qualquer pessoa que abrir o código-fonte da página lê essas credenciais. O back-end de autenticação está previsto para a etapa seguinte do projeto. A conversão de arquivos **não** exige login.

## Estrutura

```
freevertio/
├── index.html          página principal (conversor)
├── sobre.html          informações sobre o projeto
├── login.html          autenticação (provisória)
├── cria_login.html     criação de conta (em construção)
├── css/
│   └── style.css       folha de estilos única
├── js/
│   ├── conversor.js    lógica da conversão de arquivos
│   └── login.js        validação do login provisório
├── img/                ilustrações em SVG
└── README.md
```

## Tecnologias

HTML5, CSS3 e JavaScript puro — sem framework, sem biblioteca, sem etapa de build.

A conversão se apoia em três APIs nativas do navegador:

- **FileReader** — lê o arquivo escolhido como texto ou como data URL;
- **Canvas** — redesenha a imagem e reexporta no formato pedido via `canvas.toBlob()`;
- **URL.createObjectURL()** — gera o endereço temporário usado pelo link de download.

## Acessibilidade

O projeto segue a WCAG 2.2 nível AA:

- navegação completa por teclado, com indicador de foco visível;
- todas as combinações de cor acima de 4,5:1 de contraste;
- `label` associado a cada campo de formulário;
- estrutura semântica (`header`, `nav`, `main`, `section`, `footer`) e um único `h1` por página;
- mensagens de resultado anunciadas por leitores de tela (`aria-live`).

## Limitações conhecidas

- A autenticação é simulada (ver acima).
- A criação de conta e a biblioteca de arquivos convertidos ainda não existem.
- O analisador de CSV assume vírgula como separador e não trata campos entre aspas que contenham vírgulas ou quebras de linha.
- O arquivo é processado inteiro em memória, na thread principal — arquivos grandes travam a interface durante a conversão.
- Formatos que exigem bibliotecas dedicadas (PDF, DOCX, XLSX, áudio, vídeo) estão fora do escopo.

## Navegadores testados

Google Chrome 153, Mozilla Firefox 151 e Microsoft Edge 153, em Ubuntu 22.04.5 LTS.

## Uso de IA generativa

O HTML e o CSS foram escritos integralmente pelo autor. Houve uso de IA generativa para esclarecimento de dúvidas, sugestões de estilo e correção de defeitos em código já escrito. A declaração completa — ferramenta, finalidade, trecho produzido e modificações realizadas — está na Seção 11 do relatório técnico.

## Autor

Fernando Seiji Amaral Nishio
