document.getElementById('form_login').addEventListener("submit", function(event) {
    event.preventDefault();

    const email = document.getElementById("userEmail").value.trim();
    const password = document.getElementById("password").value;
    const messageError = document.getElementById("mensagem_erro");

    const emailbypass = "teste@freevertio.teste";
    const senhabypass = "senhateste123";

    if (email === emailbypass && password === senhabypass) {
        messageError.style.display = "none";
        localStorage.setItem("userlogged", email);
        window.location.href = 'convertio_piorado.html';
    } else {
        messageError.style.display = "block";
    }
});
