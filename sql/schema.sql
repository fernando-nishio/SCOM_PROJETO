-- =====================================================================
--  Freevertio - Trabalho Individual II (SCOM)
--  Script de criacao do banco de dados
--  SGBD: PostgreSQL 14+
--
--  Execucao:
--      psql -h localhost -U freevertio -d freevertio -f sql/schema.sql
--
--  O script e idempotente: pode ser executado novamente, e nesse caso
--  recria as tabelas do zero. ATENCAO: isso apaga os dados existentes.
-- =====================================================================

-- A ordem importa: uma tabela so pode ser removida depois das que
-- apontam para ela.
DROP TABLE IF EXISTS log_evento;
DROP TABLE IF EXISTS conversao;
DROP TABLE IF EXISTS sessao;
DROP TABLE IF EXISTS usuario;
DROP TABLE IF EXISTS perfil;


-- ---------------------------------------------------------------------
--  perfil
--  Tabela de dominio dos perfis de acesso. Poderia ser um CHECK na
--  tabela usuario, mas como tabela separada: (a) a lista de perfis fica
--  consultavel pela aplicacao, (b) incluir um perfil novo e um INSERT e
--  nao uma alteracao de schema, (c) gera uma chave estrangeira real.
-- ---------------------------------------------------------------------
CREATE TABLE perfil (
    codigo      VARCHAR(20)   PRIMARY KEY,
    descricao   VARCHAR(100)  NOT NULL
);

INSERT INTO perfil (codigo, descricao) VALUES
    ('usuario', 'Converte arquivos e administra a propria biblioteca'),
    ('admin',   'Acesso administrativo: todas as bibliotecas, contas e logs');


-- ---------------------------------------------------------------------
--  usuario
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
    id          SERIAL        PRIMARY KEY,
    nome        VARCHAR(120)  NOT NULL,
    email       VARCHAR(255)  NOT NULL UNIQUE,

    -- O bcrypt produz exatamente 60 caracteres. O campo e maior para
    -- permitir uma migracao futura para Argon2 sem alterar o schema.
    -- A senha em texto puro NUNCA e armazenada nem registrada em log.
    senha_hash  VARCHAR(255)  NOT NULL,

    perfil      VARCHAR(20)   NOT NULL DEFAULT 'usuario'
                              REFERENCES perfil(codigo),

    -- Desativar em vez de apagar preserva o historico de conversoes.
    ativo       BOOLEAN       NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT usuario_nome_nao_vazio
        CHECK (length(trim(nome)) > 0),

    -- Validacao minima no banco. A validacao real acontece no backend;
    -- esta existe para impedir lixo entrando por outro caminho.
    CONSTRAINT usuario_email_formato
        CHECK (email LIKE '%_@_%._%')
);


-- ---------------------------------------------------------------------
--  sessao
--  Armazenamento das sessoes do express-session via connect-pg-simple.
--
--  ATENCAO: os nomes das colunas (sid, sess, expire) sao impostos pela
--  biblioteca e nao podem ser traduzidos. Esta e a unica excecao a
--  convencao de nomenclatura em portugues adotada no projeto.
-- ---------------------------------------------------------------------
CREATE TABLE sessao (
    sid     VARCHAR       PRIMARY KEY,
    sess    JSON          NOT NULL,
    expire  TIMESTAMP(6)  NOT NULL
);

-- Usado pela rotina de limpeza das sessoes vencidas.
CREATE INDEX idx_sessao_expire ON sessao (expire);


-- ---------------------------------------------------------------------
--  conversao
--  Entidade principal do dominio: um registro por arquivo guardado na
--  biblioteca de um usuario.
--
--  O arquivo em si NAO fica no banco. Ele e gravado em armazenamento/
--  com o nome de nome_armazenado (UUID), e o banco guarda apenas a
--  referencia. Isso mantem o banco leve e os dumps utilizaveis.
--
--  Consequencia: apagar uma conversao exige remover a linha E o arquivo
--  do disco. A camada de servico e responsavel por manter os dois em
--  sincronia.
-- ---------------------------------------------------------------------
CREATE TABLE conversao (
    id                SERIAL        PRIMARY KEY,

    -- Apagar a conta apaga a biblioteca junto. E o comportamento que o
    -- usuario espera de "excluir minha conta".
    usuario_id        INTEGER       NOT NULL
                                    REFERENCES usuario(id) ON DELETE CASCADE,

    -- Nome que o usuario reconhece. Nunca usado como caminho em disco.
    nome_original     VARCHAR(255)  NOT NULL,

    formato_origem    VARCHAR(10)   NOT NULL,
    formato_destino   VARCHAR(10)   NOT NULL,

    -- 'local'    = convertido no navegador e enviado apenas para guardar
    -- 'servidor' = convertido no servidor
    -- Registrar isso permite mostrar ao usuario, item a item, onde o
    -- arquivo dele foi processado.
    origem_conversao  VARCHAR(10)   NOT NULL,

    tipo_mime         VARCHAR(100)  NOT NULL,
    tamanho_bytes     BIGINT        NOT NULL,

    -- Nome do arquivo em disco. UUID gerado pelo servidor: o nome
    -- enviado pelo cliente nunca toca o sistema de arquivos, o que
    -- elimina path traversal e colisao de nomes.
    nome_armazenado   UUID          NOT NULL UNIQUE,

    criado_em         TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- NULL = sem prazo. Preenchido quando houver politica de retencao.
    expira_em         TIMESTAMPTZ,

    CONSTRAINT conversao_origem_valida
        CHECK (origem_conversao IN ('local', 'servidor')),

    CONSTRAINT conversao_tamanho_positivo
        CHECK (tamanho_bytes > 0),

    CONSTRAINT conversao_formatos_diferentes
        CHECK (formato_origem <> formato_destino),

    CONSTRAINT conversao_expira_depois_de_criada
        CHECK (expira_em IS NULL OR expira_em > criado_em)
);

-- Indice da consulta mais frequente do sistema: "minha biblioteca, dos
-- mais recentes para os mais antigos". Cobre o filtro e a ordenacao numa
-- unica estrutura.
CREATE INDEX idx_conversao_usuario_data
    ON conversao (usuario_id, criado_em DESC);

-- Indice parcial: so indexa as linhas com prazo de validade, que sao a
-- minoria. Menor e mais rapido que um indice sobre a coluna inteira.
CREATE INDEX idx_conversao_expira
    ON conversao (expira_em)
    WHERE expira_em IS NOT NULL;


-- ---------------------------------------------------------------------
--  log_evento
--  Observabilidade. Registra, no minimo, os quatro eventos exigidos:
--  login bem-sucedido, falha de autenticacao, criacao de entidade e
--  erro interno.
-- ---------------------------------------------------------------------
CREATE TABLE log_evento (
    id           BIGSERIAL     PRIMARY KEY,
    ocorrido_em  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    nivel        VARCHAR(10)   NOT NULL,

    -- Identificador curto e estavel do evento, p.ex. 'login_sucesso'.
    -- Ser um codigo e nao uma frase permite agregar e contar.
    evento       VARCHAR(60)   NOT NULL,

    -- Nulo de proposito: uma falha de login pode nao ter usuario
    -- identificado. E SET NULL, nao CASCADE: apagar a conta nao pode
    -- apagar o rastro de auditoria.
    usuario_id   INTEGER       REFERENCES usuario(id) ON DELETE SET NULL,

    -- Tipo nativo do PostgreSQL para enderecos IP. Valida o formato
    -- sozinho e aceita IPv4 e IPv6.
    ip           INET,

    -- Texto livre. NUNCA deve conter senha, conteudo de arquivo ou
    -- token de sessao.
    detalhe      TEXT,

    CONSTRAINT log_nivel_valido
        CHECK (nivel IN ('info', 'aviso', 'erro'))
);

CREATE INDEX idx_log_data   ON log_evento (ocorrido_em DESC);
CREATE INDEX idx_log_evento ON log_evento (evento);
