# Observa · Radar Ódio

Protótipo local de anotação de discurso de ódio com SPA em JavaScript, API Express e banco SQLite centralizado.

## Executar

Requer Node.js 22.5 ou superior.

```bash
npm install
npm start
```

Acesse `http://localhost:3000`. O servidor escuta em `0.0.0.0`, portanto avaliadores na mesma rede podem acessar pelo endereço IP da máquina que executa a aplicação. O banco é criado automaticamente em `data/radar-avaliacao.sqlite`.

No primeiro uso, a conta administrativa padrão é:

```text
Usuário: admin
Senha: Admin@Radar2026
```

Para definir outras credenciais antes da primeira execução, copie `.env.example` para `.env` e altere `ADMIN_USERNAME`, `ADMIN_PASSWORD` e `ADMIN_EMAIL`. Se o banco já tiver sido criado, essas variáveis não substituem a conta existente.

O PapaParse é servido localmente. Tailwind CSS e Google Fonts continuam por CDN; sem internet a importação ainda funciona, mas o acabamento visual pode ser reduzido.

## Fluxo

1. Entre com a conta administrativa.
2. Cadastre cada avaliador com nome, e-mail e usuário. O servidor gera uma senha temporária, exibida ao administrador apenas uma vez.
3. No primeiro login, o avaliador informa a senha temporária e precisa criar uma senha pessoal antes de acessar os lotes.
4. Importe um ou mais CSVs e indique explicitamente qual coluna textual será analisada.
5. Escolha o modo individual ou dupla e os avaliadores responsáveis.
6. Cada avaliador realiza apenas os lotes atribuídos à própria conta.
7. Em lotes duplos, abra Reconciliação para resolver divergências e consultar Kappa de Cohen.
8. Baixe o CSV consolidado em Resultados.

Se um avaliador esquecer a senha, use **Redefinir senha** na equipe de avaliadores. O sistema encerra as sessões existentes, gera uma nova senha temporária e exige outra troca no próximo acesso.

O CSV exportado preserva todas as colunas de entrada e cria ou atualiza:

- `hate/no_hate`: decisão final `hate` ou `nao_hate`;
- `tipos_hate`: categorias finais separadas por ` | `;
- colunas de auditoria das avaliações individuais, concordância, reconciliação e Kappa.

Somente o administrador pode importar, atribuir, reconciliar e baixar CSVs. Avaliadores podem apenas acessar seus lotes, classificar e revisar as próprias respostas.

Um lote duplo só recebe status `concluido` quando todas as avaliações foram registradas e todas as divergências de classificação foram reconciliadas.

## Persistência e segurança

- O schema versionado está em `server/db/schema.sql`.
- Todas as escritas usam prepared statements.
- Conteúdos importados são inseridos na interface com `textContent`.
- Campos perigosos para planilhas recebem sanitização contra CSV Injection na exportação.
- A sessão é mantida por cookie HTTP-only e as senhas são derivadas com `scrypt` e salt individual.
- Senhas temporárias são geradas no servidor, exibidas uma única vez e substituídas obrigatoriamente no primeiro acesso.
- A redefinição administrativa de senha encerra todas as sessões ativas do avaliador.
- `localStorage` guarda somente a preferência de tema.
- O PapaParse é servido localmente pelo Express, portanto a importação não depende do CDN.

## Testes

```bash
npm test
```

O teste integrado usa um banco temporário e cobre senha temporária, troca obrigatória, redefinição administrativa, invalidação de sessão, login e permissões, avaliação dupla, cálculo de concordância, reconciliação, transição de status e exportação CSV.
