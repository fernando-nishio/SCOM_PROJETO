// Conversor de arquivos do Freevertio (roda 100% no navegador)

let arquivoAtual = null;
let categoriaDetectada = null;
let urlDownloadAnterior = null;

// Formatos de saída
const FORMATOS_IMAGEM = [
  { rotulo: "JPEG (.jpg)", valor: "image/jpeg", ext: "jpg" },
  { rotulo: "PNG (.png)", valor: "image/png", ext: "png" },
  { rotulo: "WEBP (.webp)", valor: "image/webp", ext: "webp" }
];

const FORMATOS_DADOS = {
  csv: [
    { rotulo: "JSON (.json)", valor: "json", ext: "json" },
    { rotulo: "Texto em maiúsculas (.txt)", valor: "maiusculas", ext: "txt" }
  ],
  json: [
    { rotulo: "CSV (.csv)", valor: "csv", ext: "csv" },
    { rotulo: "Texto em maiúsculas (.txt)", valor: "maiusculas", ext: "txt" }
  ],
  txt: [
    { rotulo: "Texto em maiúsculas (.txt)", valor: "maiusculas", ext: "txt" }
  ]
};

const EXTENSOES_IMAGEM = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

const inputArquivo = document.getElementById("arquivo_input");
const infoArquivo = document.getElementById("info_arquivo");
const nomeArquivo = document.getElementById("nome_arquivo");
const tipoArquivo = document.getElementById("tipo_arquivo");
const controleConversao = document.getElementById("controle_conversao");
const selectFormato = document.getElementById("formato_select");
const botaoConverter = document.getElementById("botao_converter");
const areaSaida = document.getElementById("area_saida");

inputArquivo.addEventListener("change", prepararArquivo);
botaoConverter.addEventListener("click", converter);

// Lista os formatos de saída possíveis para o arquivo de entrada
function obterFormatos(extensao) {
  if (EXTENSOES_IMAGEM[extensao]) {
    categoriaDetectada = "imagem";
    // não oferece converter para o mesmo formato
    return FORMATOS_IMAGEM.filter(f => f.valor !== EXTENSOES_IMAGEM[extensao]);
  }
  if (FORMATOS_DADOS[extensao]) {
    categoriaDetectada = "dados";
    return FORMATOS_DADOS[extensao];
  }
  categoriaDetectada = null;
  return [];
}

function prepararArquivo() {
  if (!inputArquivo.files || !inputArquivo.files[0]) return;

  arquivoAtual = inputArquivo.files[0];
  const extensao = arquivoAtual.name.split(".").pop().toLowerCase();
  const formatos = obterFormatos(extensao);

  nomeArquivo.textContent = arquivoAtual.name;
  infoArquivo.hidden = false;
  limparSaida();

  if (formatos.length === 0) {
    tipoArquivo.textContent = "Não suportado";
    controleConversao.hidden = true;
    mostrarErro(`O formato ".${extensao}" não é suportado para conversão no navegador.`);
    return;
  }

  tipoArquivo.textContent = categoriaDetectada === "imagem" ? "Imagem" : "Texto / Dados";
  selectFormato.innerHTML = "";
  formatos.forEach(formato => {
    const opcao = document.createElement("option");
    opcao.value = formato.valor;
    opcao.textContent = formato.rotulo;
    opcao.dataset.ext = formato.ext;
    selectFormato.appendChild(opcao);
  });
  controleConversao.hidden = false;
}

function converter() {
  if (!arquivoAtual || !categoriaDetectada) return;

  const formato = selectFormato.value;
  const ext = selectFormato.options[selectFormato.selectedIndex].dataset.ext;

  if (categoriaDetectada === "imagem") {
    converterImagem(arquivoAtual, formato, ext);
  } else {
    converterDados(arquivoAtual, formato, ext);
  }
}

function converterImagem(arquivo, formato, ext) {
  const leitor = new FileReader();
  leitor.onload = function (evento) {
    const imagem = new Image();
    imagem.onload = function () {
      const canvas = document.createElement("canvas");
      canvas.width = imagem.width;
      canvas.height = imagem.height;
      const ctx = canvas.getContext("2d");

      // JPEG não tem transparência: pinta o fundo de branco
      if (formato === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(imagem, 0, 0);
      canvas.toBlob(function (blob) {
        mostrarDownload(blob, `convertido.${ext}`);
      }, formato, 0.9);
    };
    imagem.onerror = () => mostrarErro("Não foi possível ler a imagem.");
    imagem.src = evento.target.result;
  };
  leitor.readAsDataURL(arquivo);
}

// CSV -> JSON: usa a primeira linha como cabeçalho
function csvParaJson(texto) {
  const linhas = texto.split(/\r?\n/).filter(linha => linha.trim() !== "");
  const cabecalho = linhas.shift().split(",").map(c => c.trim());
  const registros = linhas.map(linha => {
    const valores = linha.split(",");
    const registro = {};
    cabecalho.forEach((coluna, i) => {
      registro[coluna] = (valores[i] || "").trim();
    });
    return registro;
  });
  return JSON.stringify(registros, null, 2);
}

// JSON -> CSV: aceita um objeto ou uma lista de objetos
function jsonParaCsv(texto) {
  const dados = JSON.parse(texto);
  const lista = Array.isArray(dados) ? dados : [dados];
  const colunas = [...new Set(lista.flatMap(item => Object.keys(item)))];
  const linhas = lista.map(item => colunas.map(c => item[c] ?? "").join(","));
  return [colunas.join(","), ...linhas].join("\n");
}

function converterDados(arquivo, formato, ext) {
  const leitor = new FileReader();
  leitor.onload = function (evento) {
    const conteudo = evento.target.result;
    let convertido = "";

    try {
      if (formato === "json") {
        convertido = csvParaJson(conteudo);
      } else if (formato === "csv") {
        convertido = jsonParaCsv(conteudo);
      } else if (formato === "maiusculas") {
        convertido = conteudo.toUpperCase();
      }
      mostrarDownload(new Blob([convertido], { type: "text/plain" }), `convertido.${ext}`);
    } catch (erro) {
      mostrarErro("Erro na conversão. Verifique se o arquivo está formatado corretamente.");
    }
  };
  leitor.readAsText(arquivo);
}

function limparSaida() {
  if (urlDownloadAnterior) {
    URL.revokeObjectURL(urlDownloadAnterior);
    urlDownloadAnterior = null;
  }
  areaSaida.innerHTML = "";
}

function mostrarErro(mensagem) {
  limparSaida();
  const p = document.createElement("p");
  p.className = "mensagem_erro";
  p.textContent = mensagem;
  areaSaida.appendChild(p);
}

function mostrarDownload(blob, nome) {
  limparSaida();
  urlDownloadAnterior = URL.createObjectURL(blob);

  const aviso = document.createElement("p");
  aviso.className = "file_info";
  aviso.textContent = "Conversão concluída!";

  const link = document.createElement("a");
  link.href = urlDownloadAnterior;
  link.download = nome;
  link.className = "botao_primario";
  link.textContent = `Baixar ${nome}`;

  areaSaida.append(aviso, link);
}
//O Código do conversor foi feito majoritariamente com uso de IA generativa. Ela foi usada para entender a lógica do de como converter arquivos no proprio navegador e aplicar isto no site.
