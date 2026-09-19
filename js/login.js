// Login provisório (somente front-end). Será substituído pela autenticação no back-end.
document.getElementById("form_login").addEventListener("submit", function (event) {
  event.preventDefault();

  const email = document.getElementById("email_usuario").value.trim();
  const senha = document.getElementById("senha").value;
  const mensagemErro = document.getElementById("mensagem_erro");

  // Credenciais de teste (apenas para demonstração)
  const emailTeste = "teste@freevertio.teste";
  const senhaTeste = "senhateste123";

  if (email === emailTeste && senha === senhaTeste) {
    mensagemErro.hidden = true;
    localStorage.setItem("usuario_logado", email);
    window.location.href = "index.html";
  } else {
    mensagemErro.hidden = false;
  }
});
