let currentFile = null;
let detectedCategory = null;

const supportedFormats = {
  image: [
    { label: "JPEG (.jpg)", value: "image/jpeg", ext: "jpg" },
    { label: "PNG (.png)", value: "image/png", ext: "png" },
    { label: "WEBP (.webp)", value: "image/webp", ext: "webp" }
  ],
  data: [
    { label: "JSON (.json)", value: "json", ext: "json" },
    { label: "CSV (.csv)", value: "csv", ext: "csv" },
    { label: "Texto em Maiúsculas (.txt)", value: "uppercase", ext: "txt" }
  ]
};

function prepareFile() {
  const fileInput = document.getElementById('Arquivo_input');
  if (!fileInput.files || !fileInput.files[0]) return;

  currentFile = fileInput.files[0];
  const fileName = currentFile.name;
  const fileMime = currentFile.type;
  const extension = fileName.split('.').pop().toLowerCase();

  if (fileMime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    detectedCategory = 'image';
  } else if (['json', 'csv', 'txt'].includes(extension) || fileMime.includes('text') || fileMime.includes('json')) {
    detectedCategory = 'data';
  } else {
    detectedCategory = null;
  }

  const fileInfo = document.getElementById('fileInfo');
  const fileNameSpan = document.getElementById('fileName');
  const fileTypeSpan = document.getElementById('fileType');
  const formatSelect = document.getElementById('format_select');
  const conversionController = document.getElementById('conversion_controller');
  const outputArea = document.getElementById('outputArea');

  fileNameSpan.textContent = fileName;
  fileInfo.classList.remove('hidden');
  outputArea.innerHTML = '';

  if (detectedCategory && supportedFormats[detectedCategory]) {
    fileTypeSpan.textContent = detectedCategory === 'image' ? 'Imagem' : 'Texto / Dados';
    formatSelect.innerHTML = '';

    supportedFormats[detectedCategory].forEach(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      option.dataset.ext = item.ext;
      formatSelect.appendChild(option);
    });

    conversionController.classList.remove('hidden');
  } else {
    fileTypeSpan.textContent = 'Não Suportado';
    conversionController.classList.add('hidden');
    outputArea.innerHTML = `<p class="login_erro">O formato ".${extension}" não é suportado para conversão no navegador.</p>`;
  }
}

function Convert() {
  if (!currentFile || !detectedCategory) return;

  if (detectedCategory === 'image') {
    convertImage(currentFile);
  } else if (detectedCategory === 'data') {
    convertData(currentFile);
  }
}

function convertImage(file) {
  const formatSelect = document.getElementById('format_select');
  const targetFormat = formatSelect.value;
  const ext = formatSelect.options[formatSelect.selectedIndex].dataset.ext;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      if (targetFormat === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL(targetFormat, 0.9);
      displayDownloadLink(dataUrl, `convertido.${ext}`);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function convertData(file) {
  const formatSelect = document.getElementById('format_select');
  const targetFormat = formatSelect.value;
  const ext = formatSelect.options[formatSelect.selectedIndex].dataset.ext;
  const reader = new FileReader();

  reader.onload = function(e) {
    const content = e.target.result;
    let convertedContent = "";

    try {
      if (targetFormat === 'json') {
        const lines = content.split('\n');
        const result = lines.map(line => line.split(','));
        convertedContent = JSON.stringify(result, null, 2);
      } else if (targetFormat === 'csv') {
        const json = JSON.parse(content);
        convertedContent = Array.isArray(json) 
          ? json.map(row => Object.values(row).join(',')).join('\n')
          : Object.keys(json).join(',') + '\n' + Object.values(json).join(',');
      } else if (targetFormat === 'uppercase') {
        convertedContent = content.toUpperCase();
      }

      const blob = new Blob([convertedContent], { type: 'text/plain' });
      const downloadUrl = URL.createObjectURL(blob);
      displayDownloadLink(downloadUrl, `convertido.${ext}`);
    } catch (err) {
      document.getElementById('outputArea').innerHTML = "<p class='login_erro'>Erro na conversão. Certifique-se de que o arquivo está formatado corretamente!</p>";
    }
  };

  reader.readAsText(file);
}

function displayDownloadLink(url, filename) {
  document.getElementById('outputArea').innerHTML = `
    <p class="file_info">Conversão concluída!</p>
    <a href="${url}" download="${filename}" class="download_link">
      Baixar ${filename}
    </a>
  `;
}
