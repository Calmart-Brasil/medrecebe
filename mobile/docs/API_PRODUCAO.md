# Evolução para backend de produção

## Estratégia recomendada

Manter o cálculo de vencimento como uma biblioteca de domínio compartilhada e mover a fonte de verdade para uma API. O iPhone continua calculando uma prévia instantânea, mas o servidor recalcula e grava o resultado com a versão da regra aplicada.

### Entidades mínimas

- `users`: id, CPF normalizado/cifrado, nome, e-mail, status e datas de consentimento.
- `workplaces`: dono, nome, endereço, canal de conciliação e status.
- `modalities`: local, tipo, nome, valor e `payment_rule_version_id`.
- `payment_rule_versions`: regra estruturada em JSON, texto contratual, início/fim de vigência e autor.
- `attendances`: local/modalidade, snapshots de nome/valor/regra, data do atendimento, vencimento calculado e status.
- `evidence_files`: atendimento, object key privado, hash, tamanho, MIME type e retenção.
- `reconciliation_batches`: local, período, total, itens, mensagem, status e data de solicitação.
- `audit_events`: usuário, ação, entidade, versão anterior/nova, data, IP e dispositivo quando permitido.

## Regra personalizada

Persistir dois elementos juntos:

1. Estrutura calculável: `basis`, `offset`, `unit`, `adjustment`, fuso e política de feriados.
2. Evidência humana: texto contratual, observação e período de vigência.

Exemplo:

```json
{
  "basis": "end_of_month",
  "offset": 1,
  "unit": "months",
  "adjustment": "first_business_day",
  "holiday_calendar": "BR-BANKING",
  "timezone": "America/Sao_Paulo"
}
```

Nunca sobrescrever uma regra já usada. Criar uma nova versão e manter no atendimento o snapshot do valor, vencimento e versão aplicada. Na tela de cadastro, sempre exibir uma data de exemplo para o médico confirmar antes de salvar.

## API inicial

- `POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`.
- `POST /v1/auth/biometric-challenge` para vincular a sessão segura do aparelho; a biometria continua sendo verificada pelo iOS.
- CRUD `/v1/workplaces` e `/v1/workplaces/{id}/modalities`.
- CRUD `/v1/attendances`, com upload por URL pré-assinada.
- `GET /v1/dashboard?from=&to=`.
- `POST /v1/reconciliation-batches/preview` e `POST /v1/reconciliation-batches/{id}/mark-sent`.
- `DELETE /v1/account`, com o fluxo de retenção legal documentado.

## Segurança e privacidade

- CPF não deve ser identificador público; usar UUID interno.
- Senha somente no servidor com KDF resistente (Argon2id), rate limit e proteção contra enumeração.
- Tokens e chaves locais no Keychain; nunca no SQLite comum.
- Fotos em bucket privado, criptografado, com URL curta e autorização por objeto.
- Coletar o mínimo necessário; orientar para não fotografar informações clínicas sem necessidade.
- Definir retenção, exportação e exclusão com base legal e revisão jurídica/LGPD.
- Backups criptografados, restore testado, observabilidade sem conteúdo sensível e resposta a incidentes.
