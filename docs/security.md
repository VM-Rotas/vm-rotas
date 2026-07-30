# Segurança inicial

## Controles implementados

- Hash de senha com bcrypt e custo 12.
- JWT com expiração de 8 horas.
- Cookie HttpOnly, `SameSite=Lax` e `Secure` configurável.
- Helmet no backend.
- CORS restrito a `WEB_ORIGIN`.
- Validação e remoção de campos não permitidos nos DTOs.
- Autorização por função.
- Separação de chaves Google de navegador e servidor.
- Isolamento lógico por organização.
- Registros de auditoria.

## Produção

- Defina `COOKIE_SECURE=true`.
- Use uma chave JWT aleatória de alta entropia.
- Publique web e API sob o mesmo domínio principal ou adicione proteção CSRF antes de usar cookies cross-site.
- Restrinja a chave Maps JavaScript por HTTP referrer.
- Restrinja a chave de Geocoding às APIs necessárias.
- Use identidade de serviço/IAM para Route Optimization.
- Mantenha `SWAGGER_ENABLED=false` no ambiente de produção.
- Habilite backups, recuperação pontual e alertas no banco.
- Faça rotação periódica dos segredos.

## Próximos reforços

- Recuperação e troca obrigatória de senha.
- MFA para administradores.
- Rate limiting de login e endpoints externos.
- Revogação de sessão por versão/token.
- Políticas mais granulares por filial e motorista.
- Testes automatizados de autorização entre tenants.
