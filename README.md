# Observa · Radar Ódio

Sistema local de anotação configurável com SPA em JavaScript, API Express e banco SQLite centralizado. Inclui o modelo padrão de discurso de ódio e permite criar outros fluxos de avaliação.

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
4. Em **Modelos**, use o modelo padrão ou crie avaliações personalizadas com seleção única, seleção múltipla, Sim/Não e texto curto.
5. Configure ramificações entre perguntas, por exemplo: mostrar “Qual é o tipo?” somente quando “É tóxico?” for “Sim”. Perguntas só podem depender de campos anteriores, evitando ciclos.
6. Importe um ou mais CSVs, indique a coluna textual principal e selecione zero ou mais colunas de contexto que serão exibidas ao avaliador.
7. Escolha o modo de avaliação e os avaliadores responsáveis:
   - **Individual:** um avaliador recebe todos os itens do lote;
   - **Dupla cega:** dois avaliadores recebem todos os itens sem acesso à resposta um do outro; qualquer diferença de classificação, categoria ou campo personalizado gera um conflito para o admin adjudicar;
   - **Em conjunto:** dois ou mais avaliadores dividem os itens do lote de maneira equilibrada e cada item é avaliado uma única vez.
8. Cada avaliador realiza apenas os lotes atribuídos à própria conta e responde somente aos campos ativos no caminho condicional.
9. Em lotes duplos cegos, abra **Conflitos** para comparar as duas respostas, adjudicar a decisão final campo a campo e consultar a concordância.
10. Baixe o CSV consolidado em Resultados.

Se um avaliador esquecer a senha, use **Redefinir senha** na equipe de avaliadores. O sistema encerra as sessões existentes, gera uma nova senha temporária e exige outra troca no próximo acesso.

O CSV exportado preserva todas as colunas de entrada. No modelo padrão, cria ou atualiza:

- `hate/no_hate`: decisão final `hate` ou `nao_hate`;
- `tipos_hate`: categorias finais separadas por ` | `;
- colunas de auditoria das avaliações individuais, concordância, reconciliação e Kappa.

Em modelos personalizados, cada campo define o próprio nome de coluna. A exportação também inclui respostas individuais, decisão reconciliada, nome e versão do modelo. Campos que não pertencem ao caminho condicional daquela linha ficam vazios.

Modelos usados em lotes são imutáveis: ao editar um modelo em uso, o sistema publica uma nova versão e mantém os lotes anteriores vinculados à definição original.

Somente o administrador pode importar, atribuir, adjudicar conflitos e baixar CSVs. Avaliadores podem apenas acessar seus lotes, classificar e revisar as próprias respostas; em modo duplo cego, nunca recebem a avaliação do outro perfil pela API.

Um lote duplo cego só recebe status `concluido` quando todas as avaliações foram registradas e todos os conflitos de classificação, categorias ou respostas personalizadas foram adjudicados.

No modo em conjunto, a distribuição usa rodízio pela ordem das linhas do CSV. A diferença entre as filas dos avaliadores é de no máximo um item. A atribuição pode ser alterada e recalculada enquanto nenhuma avaliação tiver sido registrada; depois do início, ela fica bloqueada para preservar a rastreabilidade.

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

O teste integrado usa um banco temporário e cobre senha temporária, troca obrigatória, redefinição administrativa, invalidação de sessão, login e permissões, modelos condicionais, múltiplas colunas de contexto, versionamento, avaliação dupla, distribuição conjunta equilibrada, isolamento das filas, cálculo de concordância, reconciliação personalizada, transição de status e exportação CSV.
